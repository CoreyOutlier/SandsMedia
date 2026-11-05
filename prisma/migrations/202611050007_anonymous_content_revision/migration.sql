BEGIN;
SET LOCAL lock_timeout = '5s';
-- Drive File.version also changes during harmless thumbnail processing. Bind to
-- the opaque binary headRevisionId instead, together with MD5 and both SHA256s.
ALTER TABLE media_use_events DROP CONSTRAINT media_use_events_approved_snapshot_check;
ALTER TABLE media_use_events ADD CONSTRAINT media_use_events_approved_snapshot_check CHECK (
  action <> 'approved' OR (
    file_checksum IS NOT NULL AND file_checksum ~ '^[a-f0-9]{64}$' AND
    export_checksum IS NOT NULL AND export_checksum ~ '^[a-f0-9]{64}$' AND
    drive_version IS NOT NULL AND length(drive_version) BETWEEN 1 AND 256 AND drive_version ~ '^[A-Za-z0-9_-]+$' AND
    md5_checksum IS NOT NULL AND md5_checksum ~ '^[a-f0-9]{32}$'
  )
);
COMMIT;
