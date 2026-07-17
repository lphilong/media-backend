export type Risk001GatewayFailureCategory =
  | "CONFIGURATION_FAILED"
  | "CONNECTION_FAILED"
  | "READ_FAILED"
  | "VALIDATION_FAILED"
  | "MANUAL_SCOPE_ESCALATION_REQUIRED"
  | "OUTPUT_FAILED";

export class Risk001SanitizedError extends Error {
  constructor(
    readonly category: Risk001GatewayFailureCategory,
    message: string,
  ) {
    super(sanitizeSensitiveText(message));
    this.name = "Risk001SanitizedError";
  }
}

export function sanitizeSensitiveText(value: unknown): string {
  const source = value instanceof Error ? value.message : String(value);
  return source
    .replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/giu, "[REDACTED_MONGO_URI]")
    .replace(/\b(?:MONGO_URI|MONGO_URL|AUTH0_CLIENT_SECRET|PASSWORD)\s*[=:]\s*[^\s,;]+/giu, "$1=[REDACTED]")
    .replace(/\b[\w.+-]+:[^@\s]+@(?=[\w.-]+)/gu, "[REDACTED_CREDENTIALS]@")
    .replace(/\b[0-9a-f]{24}\b/giu, "[REDACTED_OBJECT_ID]");
}
