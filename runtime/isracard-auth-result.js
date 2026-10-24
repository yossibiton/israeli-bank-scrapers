"use strict";

const AUTH_OUTCOMES = Object.freeze({
  SUCCESS: "SUCCESS",
  CHANGE_PASSWORD: "CHANGE_PASSWORD",
  UNKNOWN_ERROR: "UNKNOWN_ERROR"
});

function isCode(value, expected) {
  return value === expected || value === String(expected);
}
function safeCode(value) {
  return ["string", "number"].includes(typeof value) && /^\d{1,3}$/.test(String(value)) ? String(value) : null;
}

function classifyIsracardValidation(response) {
  const bean = response && typeof response === "object" ? response.ValidateIdDataBean : undefined;
  const expectedShape = Boolean(response && typeof response === "object" &&
    response.Header && typeof response.Header === "object" && bean && typeof bean === "object");
  const code = expectedShape ? safeCode(bean.returnCode) : null;

  if (expectedShape && isCode(response.Header.Status, 1) && isCode(bean.returnCode, 1)) {
    return { outcome: "CONTINUE_LOGIN", diagnostic: { stage: "validation", code, expectedShape } };
  }
  if (expectedShape && isCode(response.Header.Status, 1) && isCode(bean.returnCode, 4)) {
    return { outcome: AUTH_OUTCOMES.CHANGE_PASSWORD, diagnostic: { stage: "validation", code, expectedShape } };
  }
  return { outcome: AUTH_OUTCOMES.UNKNOWN_ERROR, diagnostic: { stage: "validation", code, expectedShape } };
}

function classifyIsracardLogin(response) {
  const expectedShape = Boolean(response && typeof response === "object" && !Array.isArray(response) &&
    Object.prototype.hasOwnProperty.call(response, "status"));
  const rawCode = expectedShape ? safeCode(response.status) : null;
  let outcome = AUTH_OUTCOMES.UNKNOWN_ERROR;
  if (expectedShape && isCode(response.status, 1)) outcome = AUTH_OUTCOMES.SUCCESS;
  else if (expectedShape && isCode(response.status, 3)) outcome = AUTH_OUTCOMES.CHANGE_PASSWORD;
  return { outcome, diagnostic: { stage: "login", code: rawCode, expectedShape } };
}

module.exports = { AUTH_OUTCOMES, classifyIsracardValidation, classifyIsracardLogin };
