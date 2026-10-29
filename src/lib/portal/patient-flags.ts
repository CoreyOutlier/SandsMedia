import { UploadError } from "../upload/validation.ts";

export type PatientCollection = "all" | "favorites" | "celebrities";

export function patientCollection(value: unknown, general: boolean): PatientCollection {
  const collection = value === undefined ? "all" : value;
  if (collection !== "all" && collection !== "favorites" && collection !== "celebrities") {
    throw new UploadError("INVALID_FIELDS");
  }
  if (general && collection !== "all") throw new UploadError("INVALID_FIELDS");
  return collection;
}

// Explicit assignments make retries safe and never touch consent or lifecycle state.
export function patientFlagUpdate(action: unknown, value: unknown) {
  if (typeof value !== "boolean") throw new UploadError("INVALID_FIELDS");
  if (action === "favorite") return { isFavorite: value };
  if (action === "celebrity") return { isCelebrity: value };
  throw new UploadError("INVALID_FIELDS");
}
