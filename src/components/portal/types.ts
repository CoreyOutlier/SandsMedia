export type MediaItem = { id: string; kind: string; label: string; title: string | null; bytes: number; durationS: number | null; thumbnail: string; stream: string; download: string; position: number };
export type Visit = { id: string; date: string; title: string; description?: string; uploadedBy?: string; status?: string; finished?: boolean; consented?: boolean; formOnFile?: boolean; quote?: string | null; driveUrl?: string | null; photosDriveUrl?: string | null; videosDriveUrl?: string | null; media: MediaItem[] };
export type ShareItem = { id: string; createdAt: string; expiresAt: string; revokedAt: string | null; viewCount: number; lastViewedAt: string | null; pinProtected: boolean; views: { id: string; createdAt: string }[] };
export type ConsentHistoryItem = { id: string; action: string; createdAt: string; actor: string };
export type Detail = { id: string; name: string; displayId: string; isFavorite: boolean; isCelebrity: boolean; clearance?: { status: string; missing: number }; archivedAt: string | null; consentHistory: ConsentHistoryItem[]; driveUrl: string | null; download: string; sessions: Visit[]; links: ShareItem[]; postedSessions: { id: string; title: string; date: string }[] };
export type Row = { id: string; name: string; displayId: string; isFavorite: boolean; isCelebrity: boolean; date: string; photos: number; videos: number; status: string; posted?: number; incomplete: boolean; archived: boolean };
export type ArchiveFilter = "active" | "archived" | "all";
export type CollectionFilter = "all" | "favorites" | "celebrities";
export class PortalRequestError extends Error { retryable: boolean; constructor(message: string, retryable = false) { super(message); this.retryable = retryable; } }
export async function portalApi<T>(path: string, body?: unknown, timeoutMs = 45000): Promise<T> {
 let response: Response;
 try { response = await fetch(path, { method: body === undefined ? "GET" : "POST", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(timeoutMs) }); }
 catch { throw new PortalRequestError("The connection was interrupted. Please try again.", true); }
 let data;
 try { data = await response.json(); }
 catch { throw new PortalRequestError("The server could not complete this request. Please try again.", response.status >= 500); }
 if (!response.ok) {
  const messages: Record<string, string> = {
   SIGN_IN_REQUIRED: "Your sign-in expired. Sign in again to continue.", CONSENT_REQUIRED: "Every session needs written consent before this patient can be posted or shared.",
   CONSENT_RENEWAL_STALE: "The consent record changed while this was saving. Refresh the patient and review their current status before trying again.", CONSENT_NOT_WITHDRAWN: "Consent has already changed. Refresh this patient to review the current status.", CONSENT_CONFIRMATION_REQUIRED: "Confirm that new written consent is on file before continuing.", PATIENT_ARCHIVED: "Restore this patient before adding media, posting, or sharing.",
   LINK_EXPIRED: "This link has expired or was revoked.", PIN_REQUIRED: "Enter the PIN to open this private link.", PIN_INCORRECT: "That PIN is incorrect.",
   TOO_MANY_ATTEMPTS: "Too many attempts. Please try again in 15 minutes.", PASSCODE_TOO_SHORT: "Use a passcode with at least 12 characters.",
   INVALID_FIELDS: "Please check the fields and try again.", PATIENT_NOT_FOUND: "This patient is unavailable.", UPLOAD_NOT_FOUND: "This upload is unavailable.",
   MEDIA_NOT_FOUND: "This file is unavailable.", NO_MEDIA: "There are no completed files to download.", NO_COMPLETED_SESSIONS: "Finish an upload before recording consent.", UPLOAD_INCOMPLETE: "Finish this upload before editing its video titles or consent.", INVALID_CONSENT: "Confirm that new written consent is on file before continuing.", DRIVE_UNAVAILABLE: "Private storage is taking longer than expected. Please try again."
  };
  throw new PortalRequestError(messages[data.error] ?? "This request could not be completed. Please try again.", response.status >= 500 || response.status === 408);
 }
 return data;
}
export const displayDate = (date: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(date));

// These actions are idempotent. Retrying a lost response preserves the original
// consent history; authorization failures are never retried.
async function retryPatientAction(id: string, body: unknown, timeoutMs = 45000): Promise<Detail> {
 const request = () => portalApi<Detail>(`/api/patients/${id}`, body, timeoutMs);
 try { return await request(); } catch (e) { if (e instanceof PortalRequestError && e.retryable) return request(); throw e; }
}
export const withdrawPatient = (id: string) => retryPatientAction(id, { action: "withdraw" });
export const renewPatientConsent = (id: string, requestId: string) => retryPatientAction(id, { action: "renew_consent", confirmed: true, requestId }, 180000);
