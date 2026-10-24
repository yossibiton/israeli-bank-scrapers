"use strict";

// DOM callbacks in this module are passed directly to Puppeteer page.evaluate,
// so each callback must remain self-contained.
function readPendingListPage() {
  const headings = Array.from(document.querySelectorAll("h2"));
  const matchingHeadings = headings.filter(node => (node.innerText || node.textContent || "").trim() === "עסקאות שטרם נקלטו");
  const heading = matchingHeadings.length === 1 ? matchingHeadings[0] : null;
  const slides = Array.from(document.querySelectorAll(".ui-swiper__slide"));
  const cards = slides.map((slide, index) => {
    const last4Nodes = Array.from(slide.querySelectorAll("span"))
      .filter(node => /^\d{4}$/.test((node.innerText || node.textContent || "").trim()));
    return {
      index,
      last4: last4Nodes.length === 1 ? (last4Nodes[0].innerText || last4Nodes[0].textContent).trim() : null,
      active: slide.classList.contains("ui-swiper__slide-active")
    };
  });
  const activeCards = cards.filter(card => card.active);
  let section = null;
  if (heading) {
    section = heading.parentElement && heading.parentElement.parentElement && heading.parentElement.parentElement.parentElement;
  }
  let declaredCount = null;
  if (heading && heading.parentElement) {
    const countNodes = Array.from(heading.parentElement.querySelectorAll("span.ui-text-variant-sr-only"));
    const values = countNodes.map(node => {
      const text = (node.innerText || node.textContent || "").trim();
      const match = text.match(/^עסקאות שטרם נקלטו (\d+) עסקאות$/);
      return match ? Number(match[1]) : null;
    }).filter(value => Number.isSafeInteger(value));
    if (values.length === 1) declaredCount = values[0];
  }
  const allRows = Array.from(document.querySelectorAll(".ui-transactionContainer"));
  const sectionHeadings = Array.from(document.querySelectorAll("h1,h2,h3"));
  const hasDocumentOrder = Boolean(heading && typeof heading.compareDocumentPosition === "function");
  const nextHeading = hasDocumentOrder && sectionHeadings
    .filter(candidate => candidate !== heading && heading.compareDocumentPosition(candidate) & 4)
    .sort((left, right) => left.compareDocumentPosition(right) & 4 ? -1 : 1)[0] || null;
  const orderIsKnown = Boolean(hasDocumentOrder && (!nextHeading || typeof nextHeading.compareDocumentPosition === "function"));
  const followsHeading = row => orderIsKnown && Boolean(heading.compareDocumentPosition(row) & 4);
  const precedesNextHeading = row => !nextHeading || Boolean(row.compareDocumentPosition(nextHeading) & 4);
  const scopedRows = section && orderIsKnown
    ? allRows.filter(row => section.contains(row) && followsHeading(row) && precedesNextHeading(row)) : [];
  const rows = scopedRows.map(row => ({
    index: allRows.indexOf(row),
    spans: Array.from(row.querySelectorAll("span.ui-text")).map(node => (node.innerText || node.textContent || "").trim())
  }));
  const paginationUnknown = !heading || !orderIsKnown || declaredCount === null || rows.length !== declaredCount;
  return {
    cards,
    selectedCardLast4: activeCards.length === 1 ? activeCards[0].last4 : null,
    headingFound: Boolean(heading),
    declaredCount,
    rows,
    paginationUnknown
  };
}

function clickPendingListRow(index) {
  const headings = Array.from(document.querySelectorAll("h2"))
    .filter(node => (node.innerText || node.textContent || "").trim() === "עסקאות שטרם נקלטו");
  const heading = headings.length === 1 ? headings[0] : null;
  if (!heading) return false;
  const section = heading.parentElement && heading.parentElement.parentElement && heading.parentElement.parentElement.parentElement;
  if (!section) return false;
  if (typeof heading.compareDocumentPosition !== "function") return false;
  const sectionHeadings = Array.from(document.querySelectorAll("h1,h2,h3"));
  const nextHeading = sectionHeadings
    .filter(candidate => candidate !== heading && heading.compareDocumentPosition(candidate) & 4)
    .sort((left, right) => left.compareDocumentPosition(right) & 4 ? -1 : 1)[0] || null;
  const allRows = Array.from(document.querySelectorAll(".ui-transactionContainer"));
  const scopedRows = allRows.filter(row => section.contains(row)
    && Boolean(heading.compareDocumentPosition(row) & 4)
    && (!nextHeading || Boolean(row.compareDocumentPosition(nextHeading) & 4)));
  const row = scopedRows.find(candidate => allRows.indexOf(candidate) === index);
  if (!row) return false;
  row.click();
  return true;
}

function clickPendingCard(index) {
  const bullets = Array.from(document.querySelectorAll(".ui-swiper__bullet"));
  const bullet = bullets[index];
  if (!bullet) return false;
  bullet.click();
  return true;
}

function isTransactionsPage() {
  return window.location.pathname === "/transactions";
}

function readPendingNavigation() {
  const monthNames = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
  const normalize = text => (text || "").replace(/\s+/g, " ").trim();
  const isMonth = label => {
    const match = label.match(/^(.+?)(?:\s+(\d{2}|\d{4}))?$/);
    return Boolean(match && monthNames.includes(match[1]) && (!match[2] || match[2].length === 2 || match[2].length === 4));
  };
  const controls = Array.from(document.querySelectorAll("button,a,[role=tab]"));
  const monthControls = [];
  controls.forEach((control, index) => {
    const label = normalize(control.innerText || control.textContent || "");
    if (!isMonth(label)) return;
    monthControls.push({
      index,
      label,
      tag: (control.tagName || "").toLowerCase(),
      cls: typeof control.className === "string" ? control.className : "",
      role: control.getAttribute("role"),
      ariaSelected: control.getAttribute("aria-selected"),
      ariaCurrent: control.getAttribute("aria-current"),
      ariaPressed: control.getAttribute("aria-pressed"),
      parentClass: control.parentElement && typeof control.parentElement.className === "string" ? control.parentElement.className : ""
    });
  });
  const exactHeading = "עסקאות שטרם נקלטו";
  const pendingHeadingTags = [];
  for (const tag of ["h1", "h2", "h3", "h4", "p"]) {
    for (const heading of document.querySelectorAll(tag)) {
      if (normalize(heading.innerText || heading.textContent || "") === exactHeading) pendingHeadingTags.push(tag);
    }
  }
  const roleCounts = {};
  for (const node of document.querySelectorAll("[role]")) {
    const role = node.getAttribute("role");
    if (role === "option" || role === "tab" || role === "list" || role === "listitem") roleCounts[role] = (roleCounts[role] || 0) + 1;
  }
  return { monthControls, pendingHeadingTags, roleCounts };
}

function clickPendingMonth(request) {
  const monthNames = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
  const normalize = text => (text || "").replace(/\s+/g, " ").trim();
  const label = normalize(request && request.label);
  const match = label.match(/^(.+?)(?:\s+(\d{2}|\d{4}))?$/);
  if (!match || !monthNames.includes(match[1])) return false;
  const controls = Array.from(document.querySelectorAll("button,a,[role=tab]"));
  const control = controls[request.index];
  if (!control || normalize(control.innerText || control.textContent || "") !== label) return false;
  control.click();
  return true;
}

module.exports = { readPendingListPage, clickPendingListRow, clickPendingCard, isTransactionsPage, readPendingNavigation, clickPendingMonth };
