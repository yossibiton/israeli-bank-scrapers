"use strict";

const PENDING_STATUS = "אושר וטרם נקלט";
const STATUS_PAGE_URL = "https://web.isracard.co.il/StatusPage";
const DASHBOARD_LIMIT = 5;

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseDate(value) {
  const match = clean(value).match(/^(\d{2})[./](\d{2})[./](\d{2}|\d{4})$/);
  if (!match) return null;
  const yearValue = Number(match[3]);
  const year = match[3].length === 2 ? (yearValue < 70 ? 2000 + yearValue : 1900 + yearValue) : yearValue;
  const month = Number(match[2]);
  const day = Number(match[1]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseMoney(value) {
  const text = clean(value).replace(/[\u00a0\u202f]/g, " ");
  const currency = "(?:₪|\\$|€|£|ILS|NIS|USD|EUR|GBP|ש\"ח|ש״ח)";
  const match = text.match(new RegExp(`^\\s*([+-]?)\\s*(${currency})?\\s*((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?)\\s*(${currency})?\\s*$`, "i"));
  if (!match || (!match[2] && !match[4] && !/^\s*[+-]?\s*\d/.test(text))) return null;
  if (match[2] && match[4]) return null;
  const amount = Number(`${match[1]}${match[3].replaceAll(",", "")}`);
  if (!Number.isFinite(amount)) return null;
  return { amount, explicitSign: Boolean(match[1]), raw: text, currency: match[2] || match[4] || null };
}

function normalizeMerchant(value) {
  return clean(value).normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ");
}

function currencyCode(value) {
  const text = clean(value);
  if (/(?:₪|\bILS\b|\bNIS\b|ש"ח|ש״ח|שקל(?: חדש)?)/i.test(text)) return "ILS";
  if (/\bUSD\b|\$/.test(text)) return "USD";
  if (/\bEUR\b|€/.test(text)) return "EUR";
  if (/\bGBP\b|£/.test(text)) return "GBP";
  return text || null;
}

function signedCardAmount(parsed) {
  if (!parsed) return null;
  // The Isracard approval display lists card authorizations as positive magnitudes.
  // Keep an explicit provider sign; otherwise apply the documented card-expense sign.
  return parsed.explicitSign ? parsed.amount : -Math.abs(parsed.amount);
}

function parseDashboardRow(spanTexts) {
  const values = spanTexts.map(clean).filter(Boolean);
  if (!values.includes(PENDING_STATUS)) return null;
  const dateText = values.find(value => /^\d{2}[./]\d{2}[./](?:\d{2}|\d{4})$/.test(value)) || null;
  const amountText = values.find(value => parseMoney(value)?.currency) || null;
  const description = values.find(value => value !== PENDING_STATUS && value !== dateText && value !== amountText) || "";
  return {
    description,
    date: parseDate(dateText),
    displayAmount: amountText,
    status: PENDING_STATUS
  };
}

function diagnoseApprovalDetails({ fields = {}, cardLast4 = null, dashboardRow = {} }) {
  const detailDescription = clean(fields["שם בית עסק"]);
  const detailDate = parseDate(fields["תאריך עסקה"]);
  const dashboardDescription = clean(dashboardRow.description);
  const description = detailDescription || dashboardDescription;
  const date = detailDate || dashboardRow.date || null;
  const original = parseMoney(fields["סכום מקורי"]);
  const estimatedIls = parseMoney(fields["סכום מוערך בש\"ח"]);
  const displayAmount = parseMoney(dashboardRow.displayAmount);
  const originalCurrency = currencyCode(fields["מטבע מקורי"]);
  const charged = estimatedIls || (originalCurrency === "ILS" ? original : null)
    || (currencyCode(dashboardRow.displayAmount) === "ILS" ? displayAmount : null);
  const cardSuffix = /^\d{4}$/.test(String(cardLast4 ?? "")) ? String(cardLast4) : null;
  let reason = null;
  if (!detailDescription || !dashboardDescription) reason = "missing_merchant";
  else if (normalizeMerchant(detailDescription) !== normalizeMerchant(dashboardDescription)) reason = "merchant_mismatch";
  else if (!detailDate) reason = "missing_date";
  else if (dashboardRow.date && detailDate !== dashboardRow.date) reason = "date_mismatch";
  else if (!charged) reason = "missing_amount";
  else if (!dashboardAmountsMatch({ displayAmount, dashboardRow, original, originalCurrency, charged })) reason = "amount_mismatch";
  else if (!cardSuffix) reason = "missing_card";
  else if (dashboardRow.accountLast4 && cardSuffix !== dashboardRow.accountLast4) reason = "card_mismatch";
  if (reason) return { transaction: null, reason };
  return { reason: null, transaction: {
    accountLast4: cardSuffix,
    identifier: null,
    status: "pending",
    date,
    processedDate: null,
    chargedAmount: signedCardAmount(charged),
    chargedCurrency: "ILS",
    originalAmount: original ? signedCardAmount(original) : null,
    originalCurrency,
    description,
    memo: null,
    installments: undefined,
    needsReview: true,
    identityQuality: "missing-provider-identifier",
    rawTransaction: {
      source: "isracard-status-page",
      dashboardRow,
      approvalDetails: fields,
      cardLast4: cardSuffix
    }
  } };
}

function dashboardAmountsMatch({ displayAmount, dashboardRow, original, originalCurrency, charged }) {
  if (!displayAmount || !dashboardRow.displayAmount) return true;
  const dashboardCurrency = currencyCode(dashboardRow.displayAmount);
  let detailAmount;
  let detailCurrency;
  if (dashboardCurrency === "ILS") {
    detailAmount = charged.amount;
    detailCurrency = "ILS";
  } else {
    detailAmount = original?.amount;
    detailCurrency = originalCurrency;
  }
  if (!detailAmount || !dashboardCurrency || !detailCurrency || dashboardCurrency !== detailCurrency) return false;
  return Math.abs(Math.abs(displayAmount.amount) - Math.abs(detailAmount)) < 0.005;
}

function parseApprovalDetails(input) {
  return diagnoseApprovalDetails(input).transaction;
}

function readDashboardRows() {
  return Array.from(document.querySelectorAll(".ui-transactionContainer"), container =>
    Array.from(container.querySelectorAll("span.ui-text"), span => span.innerText || span.textContent || ""));
}

function readApprovalDetails() {
  const labels = ["שם בית עסק", "תאריך עסקה", "שעת ביצוע", "מדינה", "ענף", "אופן ביצוע עסקה", "סכום מקורי", "מטבע מקורי", "סכום מוערך בש\"ח"];
  const fields = {};
  for (const labelNode of document.querySelectorAll("p.ui-text-variant-h5")) {
    const label = (labelNode.innerText || labelNode.textContent || "").replace(/\s+/g, " ").trim();
    if (!labels.includes(label)) continue;
    let ancestor = labelNode.parentElement;
    for (let depth = 0; ancestor && depth < 6; depth += 1, ancestor = ancestor.parentElement) {
      const visibleLabels = Array.from(ancestor.querySelectorAll("p.ui-text-variant-h5"))
        .filter(node => labels.includes((node.innerText || node.textContent || "").replace(/\s+/g, " ").trim()));
      const values = ancestor.querySelectorAll("p.ui-text-variant-h5-semibold");
      if (visibleLabels.length === 1 && values.length === 1) {
        fields[label] = (values[0].innerText || values[0].textContent || "").trim();
        break;
      }
    }
  }
  const cardLast4 = Array.from(document.querySelectorAll("h4 span"))
    .map(node => (node.innerText || node.textContent || "").trim())
    .find(value => /^\d{4}$/.test(value)) || null;
  return { fields, cardLast4 };
}

function clickDashboardRow(index) {
  const row = document.querySelectorAll(".ui-transactionContainer")[index];
  if (!row) throw new Error("PENDING_ROW_NOT_FOUND");
  row.click();
}

function isApprovalDetailsPage() {
  return window.location.pathname === "/approvalDetails";
}

async function scrapeIsracardPendingDashboard(page, { enabled = false, dashboardUrl = STATUS_PAGE_URL, detailsReadyTimeoutMs = 10000 } = {}) {
  const coverage = {
    source: "isracard-status-page",
    status: enabled ? "partial" : "disabled",
    coverage: enabled ? "last-five-dashboard-rows" : "not-requested",
    dashboardRowLimit: DASHBOARD_LIMIT,
    dashboardRowsReturned: 0,
    rowsInScope: 0,
    pendingRowsVisible: 0,
    inspectedRows: 0,
    parsedTransactions: 0,
    unresolvedRows: 0,
    reasonCounts: {},
    unresolvedEvidence: [],
    failure: null
  };
  if (!enabled) return { transactions: [], coverage };

  const transactions = [];
  try {
    await page.goto(dashboardUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".ui-transactionContainer", { timeout: 15000 });
    const allRows = await page.evaluate(readDashboardRows);
    const dashboardRows = allRows.slice(0, DASHBOARD_LIMIT);
    coverage.dashboardRowsReturned = allRows.length;
    coverage.rowsInScope = dashboardRows.length;
    const pendingRows = dashboardRows
      .map((spans, index) => ({ row: parseDashboardRow(spans), index }))
      .filter(item => item.row);
    coverage.pendingRowsVisible = pendingRows.length;

    const recordUnresolved = (row, index, details, reason) => {
      coverage.unresolvedRows += 1;
      coverage.reasonCounts[reason] = (coverage.reasonCounts[reason] || 0) + 1;
      coverage.unresolvedEvidence.push({ index, dashboardRow: row, ...(details ? { details } : {}), reason });
    };
    for (const { row, index } of pendingRows) {
      coverage.inspectedRows += 1;
      let navigatedToDetails = false;
      let details = null;
      try {
        await page.evaluate(clickDashboardRow, index);
        await page.waitForFunction(isApprovalDetailsPage, { timeout: 10000 });
        navigatedToDetails = true;
        const diagnosed = await readMatchingApprovalDetails(page, row, { timeoutMs: detailsReadyTimeoutMs });
        details = diagnosed.details;
        if (diagnosed.transaction) transactions.push(diagnosed.transaction);
        else recordUnresolved(row, index, details, diagnosed.reason || "details_not_ready");
      } catch {
        recordUnresolved(row, index, details, "navigation_or_dom_failed");
      }
      if (navigatedToDetails) {
        try {
          await page.goBack({ waitUntil: "domcontentloaded" });
          await page.waitForSelector(".ui-transactionContainer", { timeout: 10000 });
        } catch {
          recordUnresolved(row, index, details, "navigation_or_dom_failed");
        }
      } else if (index < pendingRows[pendingRows.length - 1].index) {
        try {
          await page.goto(dashboardUrl, { waitUntil: "domcontentloaded" });
          await page.waitForSelector(".ui-transactionContainer", { timeout: 10000 });
        } catch {
          recordUnresolved(row, index, details, "navigation_or_dom_failed");
        }
      }
    }
  } catch {
    coverage.failure = "dashboard-unavailable-or-structure-changed";
  }
  coverage.parsedTransactions = transactions.length;
  return { transactions, coverage };
}

async function readMatchingApprovalDetails(page, dashboardRow, { timeoutMs = 10000, pollIntervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let details = null;
  let lastReason = "details_not_ready";
  // Always inspect once, including a zero-timeout diagnostic probe.
  while (true) {
    try {
      details = await page.evaluate(readApprovalDetails);
      const diagnosed = diagnoseApprovalDetails({ ...details, dashboardRow });
      if (diagnosed.transaction) return { ...diagnosed, details };
      lastReason = diagnosed.reason || "details_not_ready";
    } catch {
      lastReason = "details_not_ready";
    }
    if (Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(pollIntervalMs, Math.max(0, deadline - Date.now()))));
  }
  return { transaction: null, details, reason: lastReason === "amount_mismatch" ? "amount_mismatch" : "details_not_ready" };
}

function attachPendingTransactions(result, transactions, coverage) {
  result.pendingDashboard = { ...coverage, transactions };
  result.pendingDashboard.reasonCounts = { ...(coverage.reasonCounts || {}) };
  result.pendingDashboard.unresolvedEvidence = [...(coverage.unresolvedEvidence || [])];
  const accountsByLast4 = new Map();
  result.pendingDashboard.attachedTransactions = 0;
  for (const account of result.accounts || []) {
    const suffix = String(account.accountNumber ?? "").replace(/\D/g, "").slice(-4);
    if (!suffix) continue;
    if (!accountsByLast4.has(suffix)) accountsByLast4.set(suffix, []);
    accountsByLast4.get(suffix).push(account);
  }
  for (const transaction of transactions) {
    const matches = accountsByLast4.get(transaction.accountLast4) || [];
    if (matches.length === 1) {
      if (!Array.isArray(matches[0].txns)) matches[0].txns = [];
      matches[0].txns.push(transaction);
      result.pendingDashboard.attachedTransactions += 1;
    } else {
      result.pendingDashboard.unresolvedRows += 1;
      const reason = matches.length ? "ambiguous_card" : "missing_card";
      result.pendingDashboard.reasonCounts[reason] = (result.pendingDashboard.reasonCounts[reason] || 0) + 1;
      result.pendingDashboard.unresolvedEvidence.push({
        index: null,
        dashboardRow: transaction.rawTransaction?.dashboardRow || null,
        details: transaction.rawTransaction?.approvalDetails || null,
        reason
      });
    }
  }
  return result;
}

module.exports = {
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
};
