const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const pendingDashboardModule = require("../runtime/isracard-pending-dashboard.js");

const {
  PENDING_STATUS,
  DASHBOARD_LIMIT,
  parseDate,
  parseMoney,
  parseDashboardRow,
  parseApprovalDetails,
  diagnoseApprovalDetails,
  readMatchingApprovalDetails,
  readDashboardRows,
  readApprovalDetails,
  isApprovalDetailsPage,
  scrapeIsracardPendingDashboard,
  attachPendingTransactions
} = pendingDashboardModule;

test("parses only exact pending dashboard rows and normalizes their date", () => {
  const row = parseDashboardRow(["ספק סינתטי", "₪ 123.45", "24.10.26", PENDING_STATUS]);
  assert.deepEqual(row, {
    description: "ספק סינתטי",
    date: "2026-10-24",
    displayAmount: "₪ 123.45",
    status: PENDING_STATUS
  });
  assert.equal(parseDashboardRow(["ספק", "₪ 20.00", "24.10.26", "נקלט"]), null);
});

test("money parsing requires a whole monetary string and dashboard money has a currency", () => {
  assert.equal(parseMoney("SHOP 123"), null);
  assert.equal(parseMoney("₪ 1.2.3"), null);
  assert.equal(parseDashboardRow(["SHOP 123", "₪ 123.45", "24.10.26", PENDING_STATUS]).displayAmount, "₪ 123.45");
  assert.equal(parseDashboardRow(["SHOP 123", "123.45", "24.10.26", PENDING_STATUS]).displayAmount, null);
});

test("date parser accepts day-month-four-digit-year and rejects invalid dates", () => {
  assert.equal(parseDate("24.10.2026"), "2026-10-24");
  assert.equal(parseDate("31.02.2026"), null);
  assert.equal(parseDate("2026-10-24"), null);
});

test("maps Isracard pending details to ILS while retaining original currency and review identity", () => {
  const transaction = parseApprovalDetails({
    dashboardRow: { description: "בית עסק סינתטי", date: "2026-10-24", displayAmount: "€ 20.00", status: PENDING_STATUS },
    cardLast4: "0123",
    fields: {
      "שם בית עסק": "בית עסק סינתטי",
      "תאריך עסקה": "24.10.26",
      "סכום מקורי": "20.00",
      "מטבע מקורי": "EUR",
      "סכום מוערך בש\"ח": "74.20 ₪"
    }
  });
  assert.equal(transaction.status, "pending");
  assert.equal(transaction.date, "2026-10-24");
  assert.equal(transaction.chargedAmount, -74.2);
  assert.equal(transaction.chargedCurrency, "ILS");
  assert.equal(transaction.originalAmount, -20);
  assert.equal(transaction.originalCurrency, "EUR");
  assert.equal(transaction.accountLast4, "0123");
  assert.equal(transaction.identifier, null);
  assert.equal(transaction.needsReview, true);
  assert.equal(transaction.identityQuality, "missing-provider-identifier");
  assert.equal(transaction.rawTransaction.source, "isracard-status-page");
});

test("rejects approval detail data that does not match the clicked dashboard row", () => {
  const dashboardRow = { description: "עסק סינתטי א", date: "2026-10-24", displayAmount: "₪ 20.00" };
  const fields = {
    "שם בית עסק": "עסק סינתטי ב",
    "תאריך עסקה": "25.10.26",
    "סכום מקורי": "20.00",
    "מטבע מקורי": "ILS",
    "סכום מוערך בש\"ח": "20.00 ₪"
  };
  assert.equal(parseApprovalDetails({ dashboardRow, fields, cardLast4: "0123" }), null);
  assert.equal(diagnoseApprovalDetails({ dashboardRow, fields, cardLast4: "0123" }).reason, "merchant_mismatch");
});

test("merchant matching normalizes Unicode, case, and whitespace without removing punctuation", () => {
  const base = {
    dashboardRow: { description: "Café  SHOP, Ltd.", date: "2026-10-24" },
    fields: { "שם בית עסק": "CAFÉ SHOP, LTD.", "תאריך עסקה": "24.10.26", "סכום מקורי": "10.00", "מטבע מקורי": "ILS" },
    cardLast4: "0123"
  };
  assert.equal(diagnoseApprovalDetails(base).reason, null);
  assert.equal(diagnoseApprovalDetails({ ...base, fields: { ...base.fields, "שם בית עסק": "CAFE SHOP LTD" } }).reason, "merchant_mismatch");
});

test("diagnostics distinguish missing date, amount, and card without returning a transaction", () => {
  const fields = { "שם בית עסק": "בית עסק סינתטי", "תאריך עסקה": "24.10.26", "סכום מקורי": "10.00", "מטבע מקורי": "ILS" };
  const dashboardRow = { description: "בית עסק סינתטי", date: "2026-10-24" };
  assert.equal(diagnoseApprovalDetails({ dashboardRow, fields: { ...fields, "תאריך עסקה": "bad" }, cardLast4: "0123" }).reason, "missing_date");
  assert.equal(diagnoseApprovalDetails({ dashboardRow, fields: { ...fields, "מטבע מקורי": "USD" }, cardLast4: "0123" }).reason, "missing_amount");
  assert.equal(diagnoseApprovalDetails({ dashboardRow, fields, cardLast4: null }).reason, "missing_card");
});

test("amount mismatch is rejected as stale details and waits for current transaction values", async () => {
  const row = { description: "עסק סינתטי", date: "2026-10-24", displayAmount: "₪ 12.00" };
  const stale = { cardLast4: "0123", fields: { "שם בית עסק": "עסק סינתטי", "תאריך עסקה": "24.10.26", "סכום מקורי": "10.00", "מטבע מקורי": "ILS", "סכום מוערך בש\"ח": "10.00 ₪" } };
  const current = { cardLast4: "0123", fields: { ...stale.fields, "סכום מקורי": "12.00", "סכום מוערך בש\"ח": "12.00 ₪" } };
  assert.equal(diagnoseApprovalDetails({ ...stale, dashboardRow: row }).reason, "amount_mismatch");
  let reads = 0;
  const page = { evaluate: async () => reads++ === 0 ? stale : current };
  const result = await readMatchingApprovalDetails(page, row, { timeoutMs: 100, pollIntervalMs: 1 });
  assert.equal(reads, 2);
  assert.equal(result.reason, null);
  assert.equal(result.transaction.chargedAmount, -12);
  assert.equal(result.details, current);
});

test("foreign dashboard amount is checked against original amount and currency", () => {
  const fields = { "שם בית עסק": "עסק סינתטי", "תאריך עסקה": "24.10.26", "סכום מקורי": "20.00", "מטבע מקורי": "EUR", "סכום מוערך בש\"ח": "74.20 ₪" };
  const common = { fields, cardLast4: "0123" };
  assert.equal(diagnoseApprovalDetails({ ...common, dashboardRow: { description: "עסק סינתטי", date: "2026-10-24", displayAmount: "€ 20.00" } }).reason, null);
  assert.equal(diagnoseApprovalDetails({ ...common, dashboardRow: { description: "עסק סינתטי", date: "2026-10-24", displayAmount: "€ 21.00" } }).reason, "amount_mismatch");
});

test("does not invent an ILS conversion for a foreign original amount without estimated ILS", () => {
  const transaction = parseApprovalDetails({
    dashboardRow: { description: "בית עסק סינתטי", date: "2026-10-24", displayAmount: "€ 20.00" },
    cardLast4: "0123",
    fields: {
      "שם בית עסק": "בית עסק סינתטי",
      "תאריך עסקה": "24.10.26",
      "סכום מקורי": "20.00",
      "מטבע מקורי": "EUR"
    }
  });
  assert.equal(transaction, null);
});

test("limits the dashboard to five rows and reports partial coverage", async () => {
  assert.equal(DASHBOARD_LIMIT, 5);
  const spanRows = Array.from({ length: 7 }, (_, index) => [
    `עסק סינתטי ${index}`,
    `₪ ${index + 1}.00`,
    "24.10.26",
    PENDING_STATUS
  ]);
  const page = new SyntheticPage(spanRows);
  const result = await scrapeIsracardPendingDashboard(page, { enabled: true });
  assert.equal(page.url, "https://web.isracard.co.il/StatusPage");
  assert.equal(result.coverage.status, "partial");
  assert.equal(result.coverage.coverage, "last-five-dashboard-rows");
  assert.equal(result.coverage.pendingRowsVisible, 5);
  assert.equal(result.coverage.dashboardRowsReturned, 7);
  assert.equal(result.coverage.rowsInScope, 5);
  assert.equal(result.coverage.inspectedRows, 5);
  assert.equal(result.coverage.parsedTransactions, 5);
  assert.deepEqual(result.coverage.reasonCounts, {});
  assert.equal(result.coverage.unresolvedEvidence.length, 0);
  assert.equal(result.transactions.length, 5);
  assert.equal(result.transactions[0].identifier, null);
});

test("does not search past the first five dashboard rows", async () => {
  const rows = Array.from({ length: 5 }, (_, index) => [`עסק שכבר נקלט ${index}`, "₪ 1.00", "24.10.26", "נקלט"]);
  rows.push(["עסק ממתין מחוץ לחלון", "₪ 10.00", "24.10.26", PENDING_STATUS]);
  const result = await scrapeIsracardPendingDashboard(new SyntheticPage(rows), { enabled: true });
  assert.equal(result.coverage.dashboardRowsReturned, 6);
  assert.equal(result.coverage.rowsInScope, 5);
  assert.equal(result.coverage.pendingRowsVisible, 0);
  assert.equal(result.transactions.length, 0);
});

test("keeps identical legitimate pending rows and does not append unmatched or ambiguous cards", () => {
  const transaction = parseApprovalDetails({
    dashboardRow: { description: "אותו בית עסק", date: "2026-10-24", displayAmount: "₪ 10.00" },
    cardLast4: "0123",
    fields: {
      "שם בית עסק": "אותו בית עסק",
      "תאריך עסקה": "24.10.26",
      "סכום מקורי": "10.00",
      "מטבע מקורי": "ILS",
      "סכום מוערך בש\"ח": "10.00 ₪"
    }
  });
  const result = {
    success: true,
    accounts: [
      { accountNumber: "card-0123", txns: [] },
      { accountNumber: "card-0123", txns: [] },
      { accountNumber: "card-9999", txns: [] }
    ]
  };
  const attached = attachPendingTransactions(result, [transaction, structuredClone(transaction), { ...transaction, accountLast4: "9998" }], {
    source: "isracard-status-page", status: "partial", unresolvedRows: 0
  });
  assert.equal(attached.success, true);
  assert.deepEqual(attached.accounts.map(account => account.txns.length), [0, 0, 0]);
  assert.equal(attached.pendingDashboard.transactions.length, 3);
  assert.equal(attached.pendingDashboard.unresolvedRows, 3);
  assert.deepEqual(attached.pendingDashboard.reasonCounts, { ambiguous_card: 2, missing_card: 1 });
  assert.equal(attached.pendingDashboard.unresolvedEvidence.length, 3);

  const uniquelyMatched = { success: true, accounts: [{ accountNumber: "card-0123", txns: [] }] };
  attachPendingTransactions(uniquelyMatched, [transaction, structuredClone(transaction)], { unresolvedRows: 0 });
  assert.equal(uniquelyMatched.accounts[0].txns.length, 2);
  assert.equal(uniquelyMatched.accounts[0].txns[0].description, uniquelyMatched.accounts[0].txns[1].description);
});

test("experimental dashboard failure leaves standard collection to its caller", async () => {
  const page = new SyntheticPage([]);
  page.goto = async () => { throw new Error("synthetic navigation failure"); };
  const result = await scrapeIsracardPendingDashboard(page, { enabled: true });
  assert.deepEqual(result.transactions, []);
  assert.equal(result.coverage.failure, "dashboard-unavailable-or-structure-changed");
  assert.equal(result.coverage.status, "partial");
  const standard = { success: true, accounts: [{ accountNumber: "synthetic", txns: [] }] };
  attachPendingTransactions(standard, result.transactions, result.coverage);
  assert.equal(standard.success, true);
  assert.equal(standard.accounts.length, 1);
  assert.deepEqual(standard.pendingDashboard.reasonCounts, {});
});

test("unresolved scraper rows retain raw-only diagnostics and aggregate safe reason counts", async () => {
  const rows = [["עסק סינתטי 0", "₪ 10.00", "24.10.26", PENDING_STATUS]];
  const page = new SyntheticPage(rows);
  page.evaluate = async function(callback, argument) {
    if (callback.name === "readDashboardRows") return this.rows;
    if (callback.name === "clickDashboardRow") { this.currentIndex = argument; this.url = "https://web.isracard.co.il/approvalDetails"; return; }
    if (callback.name === "readApprovalDetails") return {
      cardLast4: null,
      fields: { "שם בית עסק": "עסק סינתטי 0", "תאריך עסקה": "24.10.26", "סכום מקורי": "10.00", "מטבע מקורי": "ILS" }
    };
    throw new Error("unexpected synthetic page evaluation");
  };
  const capture = await scrapeIsracardPendingDashboard(page, { enabled: true, detailsReadyTimeoutMs: 1 });
  assert.equal(capture.coverage.unresolvedRows, 1);
  assert.deepEqual(capture.coverage.reasonCounts, { details_not_ready: 1 });
  assert.equal(capture.coverage.unresolvedEvidence[0].reason, "details_not_ready");
  assert.equal(capture.coverage.unresolvedEvidence[0].index, 0);
  assert.ok(capture.coverage.unresolvedEvidence[0].details);
  assert.equal(capture.transactions.length, 0);
});

test("exported browser callbacks are closure-free when serialized by Puppeteer", () => {
  const row = ["עסק סינתטי", "₪ 10.00", "24.10.26", PENDING_STATUS];
  const spanNodes = row.map(innerText => ({ innerText }));
  const container = { querySelectorAll: selector => selector === "span.ui-text" ? spanNodes : [] };
  const rowDoc = { querySelectorAll: selector => selector === ".ui-transactionContainer" ? [container] : [] };
  const evaluatedRows = vm.runInNewContext(`(${readDashboardRows.toString()})()`, { document: rowDoc });
  assert.deepEqual(JSON.parse(JSON.stringify(evaluatedRows)), [row]);

  const label = "שם בית עסק";
  const valueNode = { innerText: "עסק סינתטי" };
  const labelNode = { innerText: label, parentElement: null };
  const ancestors = [{ parentElement: null }, { parentElement: null }, { parentElement: null }];
  labelNode.parentElement = ancestors[0];
  ancestors[0].parentElement = ancestors[1];
  ancestors[1].parentElement = ancestors[2];
  ancestors.forEach(ancestor => {
    ancestor.querySelectorAll = selector => selector === "p.ui-text-variant-h5" ? [labelNode]
      : selector === "p.ui-text-variant-h5-semibold" ? [valueNode] : [];
  });
  const detailsDoc = {
    querySelectorAll: selector => selector === "p.ui-text-variant-h5" ? [labelNode]
      : selector === "h4 span" ? [{ innerText: "0123" }] : []
  };
  const details = vm.runInNewContext(`(${readApprovalDetails.toString()})()`, { document: detailsDoc });
  assert.equal(details.fields[label], "עסק סינתטי");
  assert.equal(details.cardLast4, "0123");
  assert.equal(vm.runInNewContext(`(${isApprovalDetailsPage.toString()})()`, { window: { location: { pathname: "/approvalDetails" } } }), true);
});

class SyntheticPage {
  constructor(rows) {
    this.rows = rows;
    this.url = "";
    this.currentIndex = null;
  }

  async goto(url) { this.url = url; }
  async waitForSelector() { return true; }
  async waitForFunction(predicate) {
    if (predicate.name === "isApprovalDetailsPage") assert.ok(this.url.endsWith("/approvalDetails"));
  }
  async goBack() { this.url = "https://web.isracard.co.il/StatusPage"; }

  async evaluate(callback, argument) {
    if (callback.name === "readDashboardRows") return this.rows;
    if (callback.name === "clickDashboardRow") {
      this.currentIndex = argument;
      this.url = "https://web.isracard.co.il/approvalDetails";
      return undefined;
    }
    if (callback.name === "readApprovalDetails") {
      return {
        cardLast4: "0123",
        fields: {
          "שם בית עסק": `עסק סינתטי ${this.currentIndex}`,
          "תאריך עסקה": "24.10.26",
          "סכום מקורי": `${(this.currentIndex + 1).toFixed(2)}`,
          "מטבע מקורי": "ILS",
          "סכום מוערך בש\"ח": `${(this.currentIndex + 1).toFixed(2)} ₪`
        }
      };
    }
    throw new Error("unexpected synthetic page evaluation");
  }
}
