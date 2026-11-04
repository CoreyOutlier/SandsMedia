// A consent renewal must never override a later withdrawal, archive or restore.
export function canCompleteRenewal(patient:{archivedAt:unknown;deletedAt?:unknown;consentWithdrawnAt:unknown;lifecycleVersion:number},version:number){
  return !patient.deletedAt && !patient.archivedAt && !!patient.consentWithdrawnAt && patient.lifecycleVersion===version;
}
