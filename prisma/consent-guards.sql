-- Step 1 review draft; NOT executed and not a standalone migration.
-- Incorporate after table creation in the initial migration.
-- Enable pg_trgm BEFORE the schema's GIN indexes are created.

CREATE FUNCTION reject_consent_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Constant error text: no row contents, names, or request data.
  RAISE EXCEPTION 'Consent records are append-only'
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER consent_events_no_update_or_delete
BEFORE UPDATE OR DELETE ON consent_events
FOR EACH STATEMENT EXECUTE FUNCTION reject_consent_event_mutation();

CREATE TRIGGER consent_events_no_truncate
BEFORE TRUNCATE ON consent_events
FOR EACH STATEMENT EXECUTE FUNCTION reject_consent_event_mutation();

ALTER TABLE consent_events ENABLE ALWAYS TRIGGER consent_events_no_update_or_delete;
ALTER TABLE consent_events ENABLE ALWAYS TRIGGER consent_events_no_truncate;

-- Deploy using a separate migration role. The runtime role must have only
-- SELECT and INSERT on consent_events, no ownership or schema DDL privileges.
