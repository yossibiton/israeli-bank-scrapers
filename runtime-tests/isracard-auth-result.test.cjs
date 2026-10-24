const test = require("node:test");
const assert = require("node:assert/strict");

const { classifyIsracardValidation, classifyIsracardLogin } = require("../runtime/isracard-auth-result.js");

test("Isracard validation accepts numeric and string success codes", () => {
  for (const status of [1, "1"]) {
    for (const returnCode of [1, "1"]) {
      assert.equal(classifyIsracardValidation({ Header: { Status: status }, ValidateIdDataBean: { returnCode } }).outcome, "CONTINUE_LOGIN");
    }
  }
});

test("validation failures and malformed responses remain unknown with safe diagnostics", () => {
  for (const response of [
    null,
    {},
    { Header: { Status: "1" } },
    { Header: { Status: "2" }, ValidateIdDataBean: { returnCode: 1 } }
  ]) {
    const result = classifyIsracardValidation(response);
    assert.equal(result.outcome, "UNKNOWN_ERROR");
    assert.equal(result.diagnostic.stage, "validation");
    assert.equal(JSON.stringify(result).includes("private provider message"), false);
  }
});

test("login success and explicit password change accept numeric and string codes", () => {
  for (const code of [4, "4"]) assert.equal(classifyIsracardValidation({Header:{Status:"1"},ValidateIdDataBean:{returnCode:code}}).outcome,"CHANGE_PASSWORD");
  for (const code of [1, "1"]) assert.equal(classifyIsracardLogin({ status: code }).outcome, "SUCCESS");
  for (const code of [3, "3"]) assert.equal(classifyIsracardLogin({ status: code }).outcome, "CHANGE_PASSWORD");
});

test("other login failures are unknown and never expose provider text", () => {
  const malicious = "password id cardSuffix private-provider-detail";
  for (const response of [null, {}, { status: "2", message: malicious }, { status: malicious }]) {
    const result = classifyIsracardLogin(response);
    assert.equal(result.outcome, "UNKNOWN_ERROR");
    assert.equal(JSON.stringify(result).includes(malicious), false);
    assert.equal(result.diagnostic.stage, "login");
  }
});

test("shared login sends at most one password request and accepts numeric provider success", async (t) => {
  const fetchHelpers = require("../lib/helpers/fetch.js");
  const browserHelpers = require("../lib/helpers/browser.js");
  const Scraper = require("../lib/scrapers/base-isracard-amex.js").default;
  t.mock.method(browserHelpers,"maskHeadlessUserAgent",async()=>{});
  let responses=[],calls=[];
  t.mock.method(fetchHelpers,"fetchPostWithinPage",async (_page,url,body)=>{calls.push({url,body});return responses.shift();});
  const scraper = new Scraper({companyId:"isracard"},"https://example.invalid","11");
  scraper.page={setRequestInterception:async()=>{},on:()=>{}};
  scraper.navigateTo=async()=>{};
  const credentials={id:"000000000",card6Digits:"000000",password:"synthetic-test-only"};
  responses=[{Header:{Status:1},ValidateIdDataBean:{returnCode:1,userName:"synthetic-user"}},{status:1}];
  assert.equal((await scraper.login(credentials)).success,true);
  assert.equal(calls.length,2); assert.equal(calls.filter(call=>Object.hasOwn(call.body,"Sisma")).length,1);
  calls=[]; responses=[{Header:{Status:1},ValidateIdDataBean:{returnCode:1,userName:"synthetic-user"}},{status:2,message:"private response"}];
  const failure=await scraper.login(credentials);
  assert.equal(failure.errorType,"UNKNOWN_ERROR"); assert.equal(failure.authenticationDiagnostic.code,"2");
  assert.equal(calls.length,2); assert.equal(JSON.stringify(failure).includes("private response"),false);
  calls=[]; responses=[{Header:{Status:1},ValidateIdDataBean:{returnCode:1,userName:""}},{status:1}];
  assert.equal((await scraper.login(credentials)).success,true);
  assert.equal(calls.length,2);
  assert.equal(calls[1].body.KodMishtamesh,"");
});
