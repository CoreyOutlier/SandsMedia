type Consent = { consented: boolean };
type SessionConsent = { finishedAt: Date | string | null; consentEvents: Consent[] };
export type PatientConsent = { consentWithdrawnAt: Date | string | null; archivedAt?: Date | string | null; sessions: SessionConsent[] };

export function clearance(patient: PatientConsent) {
  if (patient.archivedAt) return { status: "archived" as const, missing: 0 };
  if (patient.consentWithdrawnAt) return { status: "withdrawn" as const, missing: 0 };
  const missing = patient.sessions.filter(s => !s.finishedAt || !s.consentEvents.some(c => c.consented)).length;
  if (patient.sessions.length === 0 || missing > 0) return { status: "hold" as const, missing };
  return { status: "cleared" as const, missing: 0 };
}
