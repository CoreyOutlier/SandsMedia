export type MediaItem = { anonymousUse?: { approved: boolean; canApprove: boolean; eventId: string | null }; anonymousDownload?: string | null; id: string; kind: string; label: string; title: string | null; bytes: number; durationS: number | null; thumbnail: string; stream: string; download: string; position: number };
export type Visit = { onlineReady?: boolean; anonymousCount?: number; id: string; date: string; title: string; description?: string; uploadedBy?: string; status?: string; finished?: boolean; consented?: boolean; formOnFile?: boolean; quote?: string | null; driveUrl?: string | null; photosDriveUrl?: string | null; videosDriveUrl?: string | null; media: MediaItem[] };
export type ShareItem = { mode?: "consented" | "anonymous"; id: string; createdAt: string; expiresAt: string; revokedAt: string | null; viewCount: number; lastViewedAt: string | null; pinProtected: boolean; views: { id: string; createdAt: string }[] };
export type ConsentHistoryItem = { id: string; action: string; createdAt: string; actor: string };
export type Detail = { anonymousCount?: number; id: string; name: string; displayId: string; isFavorite: boolean; isCelebrity: boolean; clearance?: { status: string; missing: number }; archivedAt: string | null; consentHistory: ConsentHistoryItem[]; driveUrl: string | null; download: string; sessions: Visit[]; links: ShareItem[]; postedSessions: { id: string; title: string; date: string }[] };
export type Row = { anonymousCount?: number; id: string; name: string; displayId: string; isFavorite: boolean; isCelebrity: boolean; date: string; photos: number; videos: number; status: string; posted?: number; incomplete: boolean; archived: boolean };
export type ArchiveFilter = "active" | "archived" | "all";
export type CollectionFilter = "all" | "favorites" | "celebrities";
export class PortalRequestError extends Error { retryable: boolean; code?: string; constructor(message: string, retryable = false, code?: string) { super(message); this.retryable = retryable; this.code = code; } }
export async function portalApi<T>(path: string, body?: unknown, timeoutMs = 45000): Promise<T> {
 let response: Response;
 try { response = await fetch(path, { method: body === undefined ? "GET" : "POST", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(timeoutMs) }); }
 catch { throw new PortalRequestError("The connection was interrupted. Please try again.", true); }
 let data;
 try { data = await response.json(); }
 catch { throw new PortalRequestError("The server could not complete this request. Please try again.", response.status >= 500); }
 if (!response.ok) {
  const messages: Record<string, string> = {
   SIGN_IN_REQUIRED: "Your sign-in expired. Sign in again to continue.", CONSENT_REQUIRED: "Every file in this upload needs written consent or approved anonymous use before marking it posted. Sharing a named patient page requires written consent.",
   CONSENT_RENEWAL_STALE: "The consent record changed while this was saving. Refresh the patient and review their current status before trying again.", CONSENT_NOT_WITHDRAWN: "Consent has already changed. Refresh this patient to review the current status.", CONSENT_CONFIRMATION_REQUIRED: "Confirm that new written consent is on file before continuing.", PATIENT_ARCHIVED: "Restore this patient before adding media, posting, or sharing.",
   LINK_EXPIRED: "This link has expired or was revoked.", PIN_REQUIRED: "Enter the PIN to open this private link.", PIN_INCORRECT: "That PIN is incorrect.",
   TOO_MANY_ATTEMPTS: "Too many attempts. Please try again in 15 minutes.", PASSCODE_TOO_SHORT: "Use a passcode with at least 12 characters.",
   INVALID_FIELDS: "Please check the fields and try again.", PATIENT_NOT_FOUND: "This patient is unavailable.", UPLOAD_NOT_FOUND: "This upload is unavailable.",
   MEDIA_NOT_FOUND: "This file is unavailable.", NO_MEDIA: "There are no completed files to download.", NO_COMPLETED_SESSIONS: "Finish an upload before recording consent.", UPLOAD_INCOMPLETE: "Finish this upload before editing its video titles or consent.", INVALID_CONSENT: "Confirm that new written consent is on file before continuing.", DRIVE_UNAVAILABLE: "Private storage is taking longer than expected. Please try again.",
   ANONYMOUS_APPROVAL_BLOCKED: "Posting is paused for this patient or the upload is unfinished. You can still save files privately.",
   ANONYMOUS_REVIEW_REQUIRED: "This photo review expired or is unavailable. Refresh the preview and review the photo again.", ANONYMOUS_REVIEW_STALE: "The photo or its permissions changed. Refresh the preview and review the current photo before approving.", ANONYMOUS_PHOTO_UNAVAILABLE: "The review photo is temporarily unavailable. Refresh the preview to try again.",
   ANONYMOUS_CONFIRMATION_REQUIRED: "Confirm the photo review before saving anonymous-use approval.", ANONYMOUS_POLICY_CHANGED: "The review policy changed. Refresh and review this photo again.", ANONYMOUS_PHOTOS_REQUIRED: "Choose at least one approved photo for this anonymous link.", ANONYMOUS_APPROVAL_REQUIRED: "One of these photos is no longer approved for anonymous sharing. Refresh and review your selection.", ANONYMOUS_PHOTO_REQUIRED: "Anonymous-use approval is available for patient photos only.",
   DELETE_CONFIRMATION_REQUIRED: "Confirm the deletion before continuing.", DELETION_PENDING: "Removed from the portal. Drive cleanup could not finish. Retry deletion to complete it."
  };
  throw new PortalRequestError(messages[data.error] ?? "This request could not be completed. Please try again.", response.status >= 500 || response.status === 408, typeof data.error === "string" ? data.error : undefined);
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

// The server records deletion before touching Drive. Retrying the same identifier
// resumes that cleanup rather than creating another deletion operation.
async function retryDeletion(path: string, body: unknown): Promise<void> {
 const request = () => portalApi<{ deleted: true }>(path, body, 180000);
 try { await request(); } catch (e) {
  if (!(e instanceof PortalRequestError) || !e.retryable) throw e;
  try { await request(); } catch (retryError) {
   // A failed retry cannot undo the server's confirmed access removal. Preserve
   // that state in the interface even if the retry loses its network response.
   if (e.code === "DELETION_PENDING") throw e;
   throw retryError;
  }
 }
}
export const deleteLibraryMedia = (id: string, general: boolean) => retryDeletion(`/api/media/${id}/delete`, { general, confirmed: true });
export const deleteLibraryPatient = (id: string) => retryDeletion(`/api/patients/${id}/delete`, { confirmed: true });
