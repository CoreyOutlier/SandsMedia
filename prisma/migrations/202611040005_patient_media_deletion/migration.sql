BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE patients ADD COLUMN deleted_at TIMESTAMPTZ(3), ADD COLUMN drive_trashed_at TIMESTAMPTZ(3);
ALTER TABLE media ADD COLUMN deleted_at TIMESTAMPTZ(3), ADD COLUMN drive_trashed_at TIMESTAMPTZ(3);
ALTER TABLE general_media ADD COLUMN deleted_at TIMESTAMPTZ(3), ADD COLUMN drive_trashed_at TIMESTAMPTZ(3);
CREATE INDEX patients_clinic_id_deleted_at_drive_trashed_at_idx ON patients(clinic_id, deleted_at, drive_trashed_at);
CREATE INDEX media_deleted_at_drive_trashed_at_idx ON media(deleted_at, drive_trashed_at);
CREATE INDEX general_media_deleted_at_drive_trashed_at_idx ON general_media(deleted_at, drive_trashed_at);
-- Extend allowed future events without changing any existing audit row.
ALTER TABLE patient_activities DROP CONSTRAINT patient_activities_action_check;
ALTER TABLE patient_activities ADD CONSTRAINT patient_activities_action_check
  CHECK (action IN ('consent_withdrawn','renewal_recorded','consent_renewed','archived','restored','deleted'));
COMMIT;
