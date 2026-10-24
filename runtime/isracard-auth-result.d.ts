export interface AuthenticationDiagnostic {
  stage: "validation" | "login";
  code: string | null;
  expectedShape: boolean;
}
export interface AuthenticationClassification {
  outcome: "SUCCESS" | "CONTINUE_LOGIN" | "CHANGE_PASSWORD" | "UNKNOWN_ERROR";
  diagnostic: AuthenticationDiagnostic;
}
export function classifyIsracardValidation(response: unknown): AuthenticationClassification;
export function classifyIsracardLogin(response: unknown): AuthenticationClassification;
