"use strict";

const ISRACARD_ORIGIN = "https://web.isracard.co.il";
const ROUTE_PATHS = Object.freeze({ transactions: "/transactions", dashboard: "/StatusPage" });

function discoverPendingRoutes({ companyCode, baseUrl, currentUrl, links = [] } = {}) {
  if (String(companyCode) === "11") {
    return {
      transactionsUrl: `${ISRACARD_ORIGIN}${ROUTE_PATHS.transactions}`,
      dashboardUrl: `${ISRACARD_ORIGIN}${ROUTE_PATHS.dashboard}`
    };
  }
  if (String(companyCode) !== "77") return null;

  let base;
  try { base = new URL(baseUrl); } catch { return null; }
  const allowedBaseHostname = base.protocol === "https:" && !base.username && !base.password
    ? base.hostname.toLowerCase() : null;
  if (!allowedBaseHostname) return null;

  const candidates = [currentUrl, ...(Array.isArray(links) ? links : [])];
  const found = { transactionsUrl: null, dashboardUrl: null };
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    let url;
    try { url = new URL(candidate, currentUrl); } catch { continue; }
    const hostname = url.hostname.toLowerCase();
    const sameSite = hostname === allowedBaseHostname;
    const amexSite = hostname.endsWith(".americanexpress.co.il");
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
      || hostname === "isracard.co.il" || hostname.endsWith(".isracard.co.il")
      || (!sameSite && !amexSite)) continue;

    const key = url.pathname === ROUTE_PATHS.transactions ? "transactionsUrl"
      : url.pathname === ROUTE_PATHS.dashboard ? "dashboardUrl" : null;
    if (key && !found[key]) found[key] = url.href;
  }
  return found.transactionsUrl || found.dashboardUrl ? found : null;
}

module.exports = { discoverPendingRoutes };
