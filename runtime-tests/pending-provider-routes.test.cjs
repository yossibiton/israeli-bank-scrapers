const test = require("node:test");
const assert = require("node:assert/strict");
const routesModule = require("../runtime/pending-provider-routes.js");

const { discoverPendingRoutes } = routesModule;

test("uses the established Isracard routes for company 11", () => {
  assert.deepEqual(discoverPendingRoutes({ companyCode: "11" }), {
    transactionsUrl: "https://web.isracard.co.il/transactions",
    dashboardUrl: "https://web.isracard.co.il/StatusPage"
  });
});

test("discovers only observed Amex routes from the authenticated site", () => {
  const result = discoverPendingRoutes({
    companyCode: 77,
    baseUrl: "https://www.americanexpress.co.il",
    currentUrl: "https://www.americanexpress.co.il/account/overview",
    links: ["https://www.americanexpress.co.il/transactions", "/StatusPage"]
  });
  assert.deepEqual(result, {
    transactionsUrl: "https://www.americanexpress.co.il/transactions",
    dashboardUrl: "https://www.americanexpress.co.il/StatusPage"
  });
});

test("rejects cross-provider, lookalike, insecure, credentialed, and parameterized routes", () => {
  const links = [
    "https://web.isracard.co.il/transactions",
    "https://americanexpress.co.il.evil.example/transactions",
    "http://www.americanexpress.co.il/transactions",
    "https://user:pass@www.americanexpress.co.il/transactions",
    "https://www.americanexpress.co.il/transactions?next=/StatusPage",
    "https://www.americanexpress.co.il/StatusPage#section"
  ];
  assert.equal(discoverPendingRoutes({
    companyCode: "77",
    baseUrl: "https://www.americanexpress.co.il",
    currentUrl: "https://www.americanexpress.co.il/account/overview",
    links
  }), null);
});

test("does not guess an Amex route when none was observed", () => {
  assert.equal(discoverPendingRoutes({
    companyCode: "77",
    baseUrl: "https://www.americanexpress.co.il",
    currentUrl: "https://www.americanexpress.co.il/account/overview",
    links: ["https://www.americanexpress.co.il/cards"]
  }), null);
});

test("returns whichever observed Amex route exists and rejects other providers", () => {
  assert.deepEqual(discoverPendingRoutes({
    companyCode: "77",
    baseUrl: "https://www.americanexpress.co.il",
    currentUrl: "https://www.americanexpress.co.il/transactions"
  }), { transactionsUrl: "https://www.americanexpress.co.il/transactions", dashboardUrl: null });
  assert.equal(discoverPendingRoutes({ companyCode: "11", baseUrl: "https://other.example" }).transactionsUrl,
    "https://web.isracard.co.il/transactions");
  assert.equal(discoverPendingRoutes({ companyCode: "88" }), null);
});
