export function parseAllowlist(value: string | undefined): Set<string> {
  return new Set((value ?? "").split(",").map(email => email.trim().toLowerCase()).filter(Boolean));
}

export function isAllowedEmail(email: unknown, allowlist: string | undefined): boolean {
  return typeof email === "string" && parseAllowlist(allowlist).has(email.trim().toLowerCase());
}

export function canSignIn(provider: unknown, profile: unknown, allowlist: string | undefined): boolean {
  if (provider !== "google" || !profile || typeof profile !== "object") return false;
  const identity = profile as { email?: unknown; email_verified?: unknown };
  return identity.email_verified === true && isAllowedEmail(identity.email, allowlist);
}

export function safeRedirect(url: string, origin: string): string {
  try {
    const destination = new URL(url, origin);
    if (destination.origin === new URL(origin).origin && ["http:", "https:"].includes(destination.protocol)) return destination.href;
  } catch { /* Fail closed without echoing an untrusted URL. */ }
  return new URL("/patients", origin).href;
}
