BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE patients
  ADD COLUMN is_favorite BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN is_celebrity BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX patients_clinic_id_is_favorite_archived_at_idx
  ON patients(clinic_id, is_favorite, archived_at);
CREATE INDEX patients_clinic_id_is_celebrity_archived_at_idx
  ON patients(clinic_id, is_celebrity, archived_at);
COMMIT;
