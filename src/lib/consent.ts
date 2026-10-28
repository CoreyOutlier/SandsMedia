// Never rewrite an existing entry. Add a new version when wording changes.
export const CONSENT_TEXT_VERSION = 1;
export const CONSENT_TEXTS: Readonly<Record<number, string>> = Object.freeze({
  1: "This patient has agreed in writing that these photos can be shared publicly.",
});
export const CONSENT_TEXT = CONSENT_TEXTS[CONSENT_TEXT_VERSION];

export function validateConsentVersion(configured: string | undefined): boolean {
  return configured === String(CONSENT_TEXT_VERSION);
}
