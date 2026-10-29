BEGIN;
ALTER TABLE patients ADD COLUMN archived_at TIMESTAMPTZ(3), ADD COLUMN lifecycle_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE media ADD COLUMN title TEXT;
ALTER TABLE general_media ADD COLUMN title TEXT;
CREATE INDEX patients_clinic_id_archived_at_idx ON patients(clinic_id, archived_at);
CREATE TABLE patient_activities (
  id UUID PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('consent_withdrawn','renewal_recorded','consent_renewed','archived','restored')),
  actor TEXT NOT NULL,
  operation_id UUID,
  patient_version INTEGER NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX patient_activities_patient_id_created_at_idx ON patient_activities(patient_id, created_at DESC);
CREATE UNIQUE INDEX patient_activities_operation_id_action_key ON patient_activities(operation_id, action);
ALTER TABLE consent_events ADD COLUMN renewal_id UUID REFERENCES patient_activities(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE UNIQUE INDEX consent_events_session_id_renewal_id_key ON consent_events(session_id, renewal_id);
-- Preserve withdrawal history already recorded before lifecycle auditing existed.
INSERT INTO patient_activities(id,patient_id,action,actor,patient_version,created_at)
SELECT gen_random_uuid(),id,'consent_withdrawn','Previously recorded',0,consent_withdrawn_at
FROM patients WHERE consent_withdrawn_at IS NOT NULL;
CREATE FUNCTION reject_patient_activity_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Patient history is append-only' USING ERRCODE = '42501'; END;
$$;
CREATE TRIGGER patient_activities_no_update_or_delete BEFORE UPDATE OR DELETE ON patient_activities FOR EACH STATEMENT EXECUTE FUNCTION reject_patient_activity_mutation();
CREATE TRIGGER patient_activities_no_truncate BEFORE TRUNCATE ON patient_activities FOR EACH STATEMENT EXECUTE FUNCTION reject_patient_activity_mutation();
ALTER TABLE patient_activities ENABLE ALWAYS TRIGGER patient_activities_no_update_or_delete;
ALTER TABLE patient_activities ENABLE ALWAYS TRIGGER patient_activities_no_truncate;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='posting_center_app') THEN
    GRANT SELECT,INSERT ON patient_activities TO posting_center_app;
    REVOKE UPDATE,DELETE,TRUNCATE ON patient_activities FROM posting_center_app;
  END IF;
END $$;

CREATE INDEX media_title_idx ON media USING GIN (title gin_trgm_ops);
CREATE INDEX general_media_title_idx ON general_media USING GIN (title gin_trgm_ops);

COMMIT;
