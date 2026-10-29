// Owner-selected limits apply to patient and general footage alike.
export const MAX_VIDEO_MB = 5 * 1024;
export const MAX_VIDEO_SECONDS = 2 * 60 * 60;
export function validVideoDuration(seconds: unknown): seconds is number {
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 && seconds <= MAX_VIDEO_SECONDS;
}
