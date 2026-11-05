BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE media ADD COLUMN anonymous_use_version INTEGER NOT NULL DEFAULT 0 CHECK (anonymous_use_version >= 0);
ALTER TABLE share_links ADD COLUMN mode TEXT NOT NULL DEFAULT 'consented' CHECK (mode IN ('consented','anonymous'));
CREATE TABLE media_use_events (
  id UUID PRIMARY KEY,
  media_id UUID NOT NULL REFERENCES media(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  action TEXT NOT NULL CHECK (action IN ('approved','revoked')),
  operation_id UUID NOT NULL,
  actor TEXT NOT NULL,
  principal_hash TEXT NOT NULL,
  policy_text_version INTEGER NOT NULL CHECK (policy_text_version > 0),
  policy_text TEXT NOT NULL,
  file_checksum CHAR(64),
  export_checksum CHAR(64),
  drive_version TEXT,
  md5_checksum CHAR(32),
  patient_version INTEGER NOT NULL CHECK (patient_version >= 0),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT media_use_events_approved_snapshot_check CHECK (
    action <> 'approved' OR (
      file_checksum IS NOT NULL AND file_checksum ~ '^[a-f0-9]{64}$' AND
      export_checksum IS NOT NULL AND export_checksum ~ '^[a-f0-9]{64}$' AND
      drive_version IS NOT NULL AND drive_version ~ '^[0-9]+$' AND
      md5_checksum IS NOT NULL AND md5_checksum ~ '^[a-f0-9]{32}$'
    )
  )
);
CREATE UNIQUE INDEX media_use_events_operation_id_key ON media_use_events(operation_id);
CREATE UNIQUE INDEX media_use_events_media_id_version_key ON media_use_events(media_id,version);
CREATE TABLE share_photos (
  share_link_id UUID NOT NULL REFERENCES share_links(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  media_id UUID NOT NULL REFERENCES media(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  approval_id UUID NOT NULL REFERENCES media_use_events(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  position INTEGER NOT NULL CHECK (position >= 0),
  PRIMARY KEY (share_link_id,media_id)
);
CREATE UNIQUE INDEX share_photos_share_link_id_position_key ON share_photos(share_link_id,position);
CREATE INDEX share_photos_media_id_idx ON share_photos(media_id);
CREATE INDEX share_photos_approval_id_idx ON share_photos(approval_id);
CREATE FUNCTION reject_anonymous_use_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Anonymous approval history and share selections are append-only' USING ERRCODE = '42501'; END;
$$;
CREATE TRIGGER media_use_events_no_update_or_delete BEFORE UPDATE OR DELETE ON media_use_events FOR EACH STATEMENT EXECUTE FUNCTION reject_anonymous_use_mutation();
CREATE TRIGGER media_use_events_no_truncate BEFORE TRUNCATE ON media_use_events FOR EACH STATEMENT EXECUTE FUNCTION reject_anonymous_use_mutation();
CREATE TRIGGER share_photos_no_update_or_delete BEFORE UPDATE OR DELETE ON share_photos FOR EACH STATEMENT EXECUTE FUNCTION reject_anonymous_use_mutation();
CREATE TRIGGER share_photos_no_truncate BEFORE TRUNCATE ON share_photos FOR EACH STATEMENT EXECUTE FUNCTION reject_anonymous_use_mutation();
ALTER TABLE media_use_events ENABLE ALWAYS TRIGGER media_use_events_no_update_or_delete;
ALTER TABLE media_use_events ENABLE ALWAYS TRIGGER media_use_events_no_truncate;
ALTER TABLE share_photos ENABLE ALWAYS TRIGGER share_photos_no_update_or_delete;
ALTER TABLE share_photos ENABLE ALWAYS TRIGGER share_photos_no_truncate;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='posting_center_app') THEN
    GRANT SELECT,INSERT ON media_use_events,share_photos TO posting_center_app;
    REVOKE UPDATE,DELETE,TRUNCATE ON media_use_events,share_photos FROM posting_center_app;
  END IF;
END $$;
COMMIT;
