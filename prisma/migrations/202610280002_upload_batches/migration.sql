CREATE TABLE "upload_batches" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "session_id" UUID,
    "general_upload_id" UUID,
    "principal_hash" TEXT NOT NULL,
    "consented" BOOLEAN NOT NULL DEFAULT false,
    "form_on_file" BOOLEAN NOT NULL DEFAULT false,
    "manifest" JSONB NOT NULL,
    "photos_folder_id" TEXT,
    "videos_folder_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "upload_batches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "upload_batches_one_target" CHECK (num_nonnulls(session_id, general_upload_id) = 1),
    CONSTRAINT "upload_batches_consent_flags" CHECK (NOT form_on_file OR consented),
    CONSTRAINT "upload_batches_general_no_consent" CHECK (general_upload_id IS NULL OR (NOT consented AND NOT form_on_file)),
    CONSTRAINT "upload_batches_manifest_array" CHECK (jsonb_typeof(manifest) = 'array' AND jsonb_array_length(manifest) BETWEEN 1 AND 100)
);
CREATE TABLE "upload_attempts" (
    "key" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    CONSTRAINT "upload_attempts_pkey" PRIMARY KEY ("key")
);
CREATE UNIQUE INDEX "upload_batches_session_id_key" ON "upload_batches"("session_id");
CREATE UNIQUE INDEX "upload_batches_general_upload_id_key" ON "upload_batches"("general_upload_id");
CREATE INDEX "upload_batches_clinic_id_created_at_idx" ON "upload_batches"("clinic_id", "created_at");
ALTER TABLE "upload_batches" ADD CONSTRAINT "upload_batches_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "upload_batches" ADD CONSTRAINT "upload_batches_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "upload_batches" ADD CONSTRAINT "upload_batches_general_upload_id_fkey" FOREIGN KEY ("general_upload_id") REFERENCES "general_uploads"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Grants are a separate administrative operation, not a dependency on a
-- production role existing in development databases. Give the runtime role
-- SELECT/INSERT/UPDATE on these two tables only; never ownership or DELETE.
-- Existing consent_events grants and ALWAYS append-only triggers are unchanged.
