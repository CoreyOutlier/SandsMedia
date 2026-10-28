// Never accept free-form messages, Error objects, HTTP bodies, or metadata.
export type ErrorCode = "AUTH_ERROR" | "AUTH_WARNING" | "DATABASE_UNAVAILABLE" | "UNEXPECTED_ERROR";
export function reportError(code: ErrorCode) { console.error(code); }
