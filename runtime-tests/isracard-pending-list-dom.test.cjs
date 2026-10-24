const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const domModule = require("../runtime/isracard-pending-list-dom.js");

const { readPendingListPage, clickPendingListRow, clickPendingCard, isTransactionsPage, readPendingNavigation, clickPendingMonth } = domModule;

function node(text = "", children = []) {
  const item = {
    innerText: text,
    textContent: text,
    children,
    parentElement: null,
    classList: { contains: name => item.classes?.includes(name) ?? false },
    clicks: 0,
    click() { this.clicks += 1; },
    querySelectorAll(selector) {
      const found = [];
      const visit = current => {
        for (const child of current.children ?? []) {
          if (selector === "span" && child.tagName === "span") found.push(child);
          if (selector === "span.ui-text" && child.tagName === "span" && child.classes.includes("ui-text")) found.push(child);
          if (selector === "span.ui-text-variant-sr-only" && child.tagName === "span" && child.classes.includes("ui-text-variant-sr-only")) found.push(child);
          visit(child);
        }
      };
      visit(this);
      return found;
    },
    contains(other) {
      if (this === other) return true;
      return (this.children ?? []).some(child => child === other || child.contains(other));
    }
  };
  for (const child of children) child.parentElement = item;
  return item;
}

function span(text, classes = []) { const result = node(text); result.tagName = "span"; result.classes = classes; return result; }

function fixture({ pendingCount = 8, pendingRows = 8, includeHeading = true, ambiguousCount = false, cards = 3, postedRowsCount = 0 } = {}) {
  const heading = node("עסקאות שטרם נקלטו"); heading.tagName = "h2";
  const countLabel = span(ambiguousCount ? "עסקאות שטרם נקלטו בערך 8 עסקאות" : `עסקאות שטרם נקלטו ${pendingCount} עסקאות`, ["ui-text-variant-sr-only"]);
  const header = node("", [heading, countLabel]);
  const border = node("", [header]);
  const pendingRowsNodes = Array.from({ length: pendingRows }, (_, index) => node("", [
    span(`עסק ${index}`, ["ui-text"]), span("₪ 12.00", ["ui-text"]), span("24.10.26", ["ui-text"])
  ]));
  const postedHeading = node("עסקאות שנקלטו"); postedHeading.tagName = "h2";
  const postedRows = Array.from({ length: postedRowsCount || 1 }, () => node("", [span("עסקה שכבר נקלטה", ["ui-text"])]));
  const pendingSection = node("", [border, ...pendingRowsNodes, ...(postedRowsCount ? [postedHeading, ...postedRows] : [])]);
  const postedSection = node("", postedRowsCount ? [] : [postedHeading, ...postedRows]);
  const allRows = [...pendingRowsNodes, ...postedRows];
  const slides = Array.from({ length: cards }, (_, index) => {
    const slide = node("", [span(`123${index}`)]);
    slide.classes = index === 1 ? ["ui-swiper__slide-active"] : [];
    slide.classList = { contains: name => slide.classes.includes(name) };
    slide.className = "ui-swiper__slide";
    return slide;
  });
  const bullets = Array.from({ length: cards }, () => node());
  const root = node("", [pendingSection, postedSection, ...slides]);
  let order = 0;
  const assignOrder = current => { current.order = order++; for (const child of current.children ?? []) assignOrder(child); };
  assignOrder(root);
  const installComparison = current => {
    current.compareDocumentPosition = other => other.order > current.order ? 4 : other.order < current.order ? 2 : 0;
    for (const child of current.children ?? []) installComparison(child);
  };
  installComparison(root);
  const doc = {
    querySelectorAll(selector) {
      if (selector === "h2") return includeHeading ? [heading, postedHeading] : [postedHeading];
      if (selector === "h1,h2,h3") return includeHeading ? [heading, postedHeading] : [postedHeading];
      if (selector === ".ui-transactionContainer") return allRows;
      if (selector === ".ui-swiper__slide") return slides;
      if (selector === ".ui-swiper__bullet") return bullets;
      return [];
    }
  };
  return { doc, heading, pendingRowsNodes, postedRows, slides, bullets, pendingSection };
}

function evaluate(callback, document, extras = {}) {
  return vm.runInNewContext(`(${callback.toString()})()`, { document, ...extras });
}

test("reads rows after the pending heading and excludes the next posted section", () => {
  const f = fixture();
  const result = evaluate(readPendingListPage, f.doc);
  assert.equal(result.headingFound, true);
  assert.equal(result.declaredCount, 8);
  assert.equal(result.rows.length, 8);
  assert.equal(result.rows[0].index, 0);
  assert.equal(result.rows[0].spans[0], "עסק 0");
  assert.equal(result.rows.some(row => row.spans.includes("עסקה שכבר נקלטה")), false);
  assert.equal(result.paginationUnknown, false);
  assert.equal(result.selectedCardLast4, "1231");
});

test("an overbroad pending ancestor cannot absorb posted rows even when their combined count matches", () => {
  const f = fixture({ pendingCount: 2, pendingRows: 1, postedRowsCount: 1 });
  const result = evaluate(readPendingListPage, f.doc);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].spans[0], "עסק 0");
  assert.equal(result.paginationUnknown, true);
  assert.equal(vm.runInNewContext(`(${clickPendingListRow.toString()})(1)`, { document: f.doc }), false);
  assert.equal(f.postedRows[0].clicks, 0);
});

test("unknown document order prevents both row export and row clicks", () => {
  const f = fixture();
  delete f.heading.compareDocumentPosition;
  const result = evaluate(readPendingListPage, f.doc);
  assert.equal(result.rows.length, 0);
  assert.equal(result.paginationUnknown, true);
  assert.equal(vm.runInNewContext(`(${clickPendingListRow.toString()})(0)`, { document: f.doc }), false);
  assert.equal(f.pendingRowsNodes[0].clicks, 0);
});

test("missing heading, ambiguous header count, and row count mismatch are unknown", () => {
  const missing = evaluate(readPendingListPage, fixture({ includeHeading: false }).doc);
  assert.equal(missing.headingFound, false);
  assert.equal(missing.declaredCount, null);
  assert.equal(missing.rows.length, 0);
  assert.equal(missing.paginationUnknown, true);
  const ambiguous = evaluate(readPendingListPage, fixture({ ambiguousCount: true }).doc);
  assert.equal(ambiguous.declaredCount, null);
  assert.equal(ambiguous.paginationUnknown, true);
  const mismatch = evaluate(readPendingListPage, fixture({ pendingCount: 8, pendingRows: 7 }).doc);
  assert.equal(mismatch.declaredCount, 8);
  assert.equal(mismatch.paginationUnknown, true);
});

test("requires exactly one visible four digit label per card and exactly one active card", () => {
  const f = fixture();
  f.slides[0].children.push(span("9999"));
  f.slides[0].children[1].parentElement = f.slides[0];
  let result = evaluate(readPendingListPage, f.doc);
  assert.equal(result.cards[0].last4, null);
  assert.equal(result.selectedCardLast4, "1231");
  f.slides[2].classes.push("ui-swiper__slide-active");
  result = evaluate(readPendingListPage, f.doc);
  assert.equal(result.selectedCardLast4, null);
});

test("row and card clicks are scoped and transactions page checks only pathname", () => {
  const f = fixture();
  assert.equal(evaluate(clickPendingListRow, f.doc, { index: 0 }), false); // callback argument is supplied by Puppeteer separately
  const rowClick = vm.runInNewContext(`(${clickPendingListRow.toString()})(0)`, { document: f.doc });
  assert.equal(rowClick, true);
  assert.equal(f.pendingRowsNodes[0].clicks, 1);
  const cardClick = vm.runInNewContext(`(${clickPendingCard.toString()})(1)`, { document: f.doc });
  assert.equal(cardClick, true);
  assert.equal(f.bullets[1].clicks, 1);
  assert.equal(vm.runInNewContext(`(${isTransactionsPage.toString()})()`, { window: { location: { pathname: "/transactions" } } }), true);
  assert.equal(vm.runInNewContext(`(${isTransactionsPage.toString()})()`, { window: { location: { pathname: "/" } } }), false);
});

test("navigation diagnostic returns only visible month controls and exact pending heading structure", () => {
  const month = node("  נובמבר   2026 ");
  month.tagName = "BUTTON";
  month.className = "month-button selected";
  month.attrs = { role: "tab", "aria-selected": "true", "aria-current": null, "aria-pressed": null };
  month.getAttribute = name => month.attrs[name] ?? null;
  const other = node("הכרטיסים שלי"); other.tagName = "A"; other.className = "link";
  other.getAttribute = () => null;
  const heading = node(" עסקאות   שטרם נקלטו "); heading.tagName = "H3";
  const roleNode = node(); roleNode.getAttribute = name => name === "role" ? "option" : null;
  const doc = {
    querySelectorAll(selector) {
      if (selector === "button,a,[role=tab]") return [month, other];
      if (selector === "h1" || selector === "h2" || selector === "h4" || selector === "p") return [];
      if (selector === "h3") return [heading];
      if (selector === "[role]") return [roleNode, month];
      return [];
    }
  };
  const result = evaluate(readPendingNavigation, doc);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    monthControls: [{ index: 0, label: "נובמבר 2026", tag: "button", cls: "month-button selected", role: "tab", ariaSelected: "true", ariaCurrent: null, ariaPressed: null, parentClass: "" }],
    pendingHeadingTags: ["h3"],
    roleCounts: { option: 1, tab: 1 }
  });
});

test("month click revalidates exact index and observed Hebrew month label", () => {
  const month = node("נובמבר 2026"); month.getAttribute = () => null;
  const doc = { querySelectorAll: selector => selector === "button,a,[role=tab]" ? [month] : [] };
  const click = request => vm.runInNewContext(`(${clickPendingMonth.toString()})(${JSON.stringify(request)})`, { document: doc });
  assert.equal(click({ index: 0, label: "נובמבר 2026" }), true);
  assert.equal(month.clicks, 1);
  assert.equal(click({ index: 0, label: "נובמבר 2026 ​" }), false);
  assert.equal(click({ index: 2, label: "נובמבר 2026" }), false);
  assert.equal(click({ index: 0, label: "הכרטיסים שלי" }), false);
});
