"use strict";

const { readPendingListPage, readPendingNavigation, clickPendingListRow, clickPendingCard, isTransactionsPage } = require("./isracard-pending-list-dom");
const { PENDING_STATUS, parseDashboardRow, readMatchingApprovalDetails, isApprovalDetailsPage } = require("./isracard-pending-dashboard");
const TRANSACTIONS_URL = "https://web.isracard.co.il/transactions";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const parsedRow = entry => parseDashboardRow([...entry.spans, PENDING_STATUS]);
const signature = row => JSON.stringify([row?.description, row?.date, row?.displayAmount]);
const failureKind = error => {
  const message = String(error?.message ?? "");
  if (message === "CARD_CONTROL_MISSING") return "card_control_missing";
  for (const [pattern, kind] of [[/Execution context was destroyed/i,"context_replaced"],[/Target closed|Session closed/i,"page_closed"],[/Cannot read properties/i,"missing_dom_property"],[/is not defined/i,"undefined_reference"],[/timeout|waiting failed/i,"timeout"]]) if (pattern.test(message)) return kind;
  return ["TypeError","ReferenceError","TimeoutError"].includes(error?.name) ? error.name : "other";
};

async function settledCard(page, card, { timeoutMs = 10000, settleMs = 350 } = {}) {
  await page.waitForFunction(isTransactionsPage, { timeout: timeoutMs });
  // The URL can be ready before the re-mounted SPA has rendered its carousel.
  // Do not attempt a card click against the empty loading view.
  let state = await settledInitialCards(page, { timeoutMs, settleMs });
  if (state.selectedCardLast4 !== card.last4) {
    if (!await page.evaluate(clickPendingCard, card.index)) throw new Error("CARD_CONTROL_MISSING");
  }
  // The selected card can still be loading even when no click was needed. Use
  // network idle as a hint, then verify the rendered card and list below.
  if (page.waitForNetworkIdle) await page.waitForNetworkIdle({ idleTime: 350, timeout: timeoutMs }).catch(() => {});
  const deadline = Date.now() + timeoutMs;
  let previous = null;
  let lastSelectedState = null;
  while (Date.now() <= deadline) {
    state = await page.evaluate(readPendingListPage);
    if (state.selectedCardLast4 === card.last4) lastSelectedState = state;
    const key = JSON.stringify([state.selectedCardLast4, state.headingFound, state.declaredCount, state.rows]);
    if (state.selectedCardLast4 === card.last4 && state.headingFound && key === previous) return state;
    previous = key;
    if (Date.now() >= deadline) break;
    await pause(settleMs);
  }
  // A missing pending section can be a genuine empty/unsupported view. Wait
  // through the readiness window, then preserve it as unknown for the caller.
  if (lastSelectedState) return lastSelectedState;
  const error = new Error("CARD_OR_LIST_NOT_READY");
  error.cardState = { cards: state.cards, selectedCardLast4: state.selectedCardLast4, headingFound: state.headingFound };
  throw error;
}

async function settledInitialCards(page, { timeoutMs = 10000, settleMs = 350 } = {}) {
  if (page.waitForNetworkIdle) await page.waitForNetworkIdle({ idleTime: 350, timeout: timeoutMs }).catch(() => {});
  const deadline = Date.now() + timeoutMs;
  let previous = null;
  while (Date.now() <= deadline) {
    const state = await page.evaluate(readPendingListPage);
    const key = JSON.stringify(state.cards);
    if (state.cards.length && key === previous) return state;
    previous = key;
    if (Date.now() >= deadline) break;
    await pause(settleMs);
  }
  throw new Error("CARD_LIST_NOT_READY");
}

async function scrapeIsracardPendingList(page, { enabled = false, transactionsUrl = TRANSACTIONS_URL, detailsReadyTimeoutMs = 10000, listReadyTimeoutMs = 10000, settleMs = 350 } = {}) {
  const coverage = { source: "isracard-transactions-page", status: enabled ? "partial" : "disabled",
    coverage: enabled ? "per-card-pending-lists" : "not-requested", dashboardRowLimit: null,
    cardCount: 0, cardsInspected: 0, cards: [], listedPendingRows: 0, pendingRowsVisible: 0,
    inspectedRows: 0, parsedTransactions: 0, unresolvedRows: 0, reasonCounts: {}, unresolvedEvidence: [],
    listEnumerationComplete: false, failure: null };
  const transactions = [];
  if (!enabled) return { transactions, coverage };
  const unresolved = (reason, evidence = {}) => {
    coverage.unresolvedRows += 1;
    coverage.reasonCounts[reason] = (coverage.reasonCounts[reason] || 0) + 1;
    coverage.unresolvedEvidence.push({ reason, ...evidence });
  };
  let cards = [], initialCard = null;
  try {
    await page.goto(transactionsUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".ui-swiper__slide", { timeout: 15000 });
    const initial = await settledInitialCards(page, { timeoutMs: listReadyTimeoutMs, settleMs });
    coverage.navigation = await page.evaluate(readPendingNavigation);
    cards = initial.cards;
    initialCard = cards.find(card => card.active);
    coverage.cardCount = cards.length;
    for (const card of cards) {
      const cardCoverage = { index: card.index, accountLast4: card.last4, declaredCount: null, listedRows: 0, countMatched: false, failure: null };
      coverage.cards.push(cardCoverage);
      if (!card.last4 || cards.filter(other => other.last4 === card.last4).length !== 1) {
        cardCoverage.failure = "ambiguous_card_selector"; continue;
      }
      let state;
      try { state = await settledCard(page, card, { timeoutMs: listReadyTimeoutMs, settleMs }); }
      catch (error) { cardCoverage.failure = "card_or_list_not_ready"; cardCoverage.failureKind = failureKind(error); cardCoverage.diagnostic = error.cardState ?? null; continue; }
      coverage.cardsInspected += 1;
      cardCoverage.declaredCount = state.declaredCount;
      cardCoverage.listedRows = state.rows.length;
      cardCoverage.countMatched = state.headingFound && !state.paginationUnknown;
      if (!state.headingFound) {
        // A missing section may mean zero pending items or a loading/DOM change.
        // Without an explicit count, retain unknown rather than claiming zero.
        cardCoverage.failure = "pending_section_absent"; continue;
      }
      coverage.listedPendingRows += state.rows.length;
      coverage.pendingRowsVisible += state.rows.length;
      if (state.paginationUnknown) {
        // A broadened ancestor could include posted rows after a DOM change.
        // Preserve evidence, but do not turn uncertain rows into pending purchases.
        cardCoverage.failure = "pending_count_not_verified";
        for (const entry of state.rows) unresolved("pending_count_not_verified", { cardIndex: card.index, listRow: entry });
        continue;
      }
      const occurrences = new Map();
      const rows = state.rows.map(entry => {
        const row = parsedRow(entry), key = signature(row);
        const occurrence = occurrences.get(key) || 0; occurrences.set(key, occurrence + 1);
        return { row, occurrence };
      });
      // Private evidence for later pending-to-posted reconciliation. Keep every
      // visible authorization, even when its details cannot be opened.
      cardCoverage.observedPending = rows.map(({ row }) => ({ date: row?.date ?? null, description: row?.description ?? "" }));
      cardCoverage.pendingListVerified = rows.every(({ row }) => row?.date && row?.description);
      for (const { row, occurrence } of rows) {
        coverage.inspectedRows += 1;
        const evidence = { cardIndex: card.index, occurrence, dashboardRow: row };
        if (!row?.description || !row.date || !row.displayAmount) { unresolved("invalid_list_row", evidence); continue; }
        let navigated = false;
        let phase = "restore_card";
        try {
          // Re-resolve the same occurrence after every back-navigation. Never
          // collapse equal purchases, nor trust stale global row indexes.
          const current = await settledCard(page, card, { timeoutMs: listReadyTimeoutMs, settleMs });
          if (!current.headingFound || current.paginationUnknown) {
            cardCoverage.countMatched = false; cardCoverage.failure = "pending_count_not_verified";
            unresolved("pending_count_not_verified", evidence); continue;
          }
          if (current.declaredCount !== state.declaredCount || current.rows.length !== state.rows.length) {
            cardCoverage.countMatched = false; cardCoverage.failure = "list_changed_during_collection";
          }
          const matching = current.rows.filter(entry => signature(parsedRow(entry)) === signature(row));
          const target = matching[occurrence];
          if (!target) { unresolved("list_row_changed", evidence); continue; }
          phase = "click_pending_row";
          if (!await page.evaluate(clickPendingListRow, target.index)) throw new Error("LIST_ROW_NOT_FOUND");
          navigated = true;
          phase = "approval_route";
          await page.waitForFunction(isApprovalDetailsPage, { timeout: 10000 });
          phase = "approval_details";
          const diagnosed = await readMatchingApprovalDetails(page, { ...row, accountLast4: card.last4 }, { timeoutMs: detailsReadyTimeoutMs });
          if (diagnosed.transaction && diagnosed.transaction.accountLast4 === card.last4) {
            diagnosed.transaction.rawTransaction.source = "isracard-transactions-page";
            diagnosed.transaction.rawTransaction.listOccurrence = occurrence;
            transactions.push(diagnosed.transaction);
          } else unresolved(diagnosed.reason || "card_or_details_mismatch", { ...evidence, details: diagnosed.details });
        } catch (error) {
          let route = "unknown";
          try { const path = new URL(page.url()).pathname; if (["/transactions", "/approvalDetails", "/transactionDetails"].includes(path)) route = path; } catch {}
          unresolved("navigation_or_dom_failed", { ...evidence, phase, route, failureKind: failureKind(error), cardState: error.cardState ?? null });
        }
        if (navigated) {
          // A history traversal can restore a stale SPA card/list component.
          // Re-open the observed list route and reselect the card explicitly.
          try { await page.goto(transactionsUrl, { waitUntil: "domcontentloaded" }); await page.waitForFunction(isTransactionsPage, { timeout: 10000 }); }
          catch { coverage.failure = "return_to_list_failed"; return { transactions, coverage: { ...coverage, parsedTransactions: transactions.length } }; }
        }
      }
    }
    coverage.listEnumerationComplete = cards.length > 0 && coverage.cards.every(card => card.countMatched && !card.failure);
  } catch { coverage.failure = "transactions-page-unavailable-or-structure-changed"; }
  finally {
    if (initialCard) {
      try { await page.evaluate(clickPendingCard, initialCard.index); } catch { /* Read-only restoration is best effort. */ }
    }
  }
  coverage.parsedTransactions = transactions.length;
  return { transactions, coverage };
}

module.exports = { TRANSACTIONS_URL, settledCard, settledInitialCards, scrapeIsracardPendingList };
