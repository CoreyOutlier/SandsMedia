-- Step 1 foundation, including the owner-requested Other uploads library.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('hold', 'ready', 'posted');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('photo', 'video');

-- CreateEnum
CREATE TYPE "MediaLabel" AS ENUM ('before', 'after', 'testimonial', 'other');

-- CreateTable
CREATE TABLE "clinics" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "upload_passcode_hash" TEXT NOT NULL,
    "drive_root_folder_id" TEXT NOT NULL,
    "next_patient_number" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "clinics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "display_id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "drive_folder_id" TEXT,
    "consent_withdrawn_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "upload_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "treatment" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "testimonial_quote" TEXT,
    "uploaded_by" TEXT NOT NULL,
    "drive_folder_id" TEXT,
    "status" "SessionStatus" NOT NULL DEFAULT 'hold',
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "label" "MediaLabel" NOT NULL,
    "drive_file_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "duration_s" DOUBLE PRECISION,
    "bytes" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_events" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "consented" BOOLEAN NOT NULL,
    "form_on_file" BOOLEAN NOT NULL,
    "consent_text_version" INTEGER NOT NULL,
    "consent_text" TEXT NOT NULL,
    "consented_by" TEXT NOT NULL,
    "ip" INET NOT NULL,
    "user_agent" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_links" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "pin_hash" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '7 days'),
    "revoked_at" TIMESTAMPTZ(3),
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "last_viewed_at" TIMESTAMPTZ(3),

    CONSTRAINT "share_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_views" (
    "id" UUID NOT NULL,
    "share_link_id" UUID NOT NULL,
    "ip" INET NOT NULL,
    "user_agent" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "general_uploads" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "upload_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "uploaded_by" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "drive_folder_id" TEXT,
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "general_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "general_media" (
    "id" UUID NOT NULL,
    "general_upload_id" UUID NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "drive_file_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "duration_s" DOUBLE PRECISION,
    "bytes" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "general_media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clinics_slug_key" ON "clinics"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "clinics_drive_root_folder_id_key" ON "clinics"("drive_root_folder_id");

-- CreateIndex
CREATE UNIQUE INDEX "patients_drive_folder_id_key" ON "patients"("drive_folder_id");

-- CreateIndex
CREATE INDEX "patients_first_name_idx" ON "patients" USING GIN ("first_name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "patients_last_name_idx" ON "patients" USING GIN ("last_name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "patients_display_id_idx" ON "patients" USING GIN ("display_id" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "patients_clinic_id_display_id_key" ON "patients"("clinic_id", "display_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_upload_id_key" ON "sessions"("upload_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_drive_folder_id_key" ON "sessions"("drive_folder_id");

-- CreateIndex
CREATE INDEX "sessions_patient_id_date_idx" ON "sessions"("patient_id", "date" DESC);

-- CreateIndex
CREATE INDEX "sessions_treatment_idx" ON "sessions" USING GIN ("treatment" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "media_drive_file_id_key" ON "media"("drive_file_id");

-- CreateIndex
CREATE INDEX "media_session_id_kind_idx" ON "media"("session_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "media_session_id_position_key" ON "media"("session_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "media_session_id_file_name_key" ON "media"("session_id", "file_name");

-- CreateIndex
CREATE INDEX "consent_events_session_id_created_at_idx" ON "consent_events"("session_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "share_links_token_hash_key" ON "share_links"("token_hash");

-- CreateIndex
CREATE INDEX "share_links_patient_id_revoked_at_expires_at_idx" ON "share_links"("patient_id", "revoked_at", "expires_at");

-- CreateIndex
CREATE INDEX "share_views_share_link_id_created_at_idx" ON "share_views"("share_link_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "general_uploads_upload_id_key" ON "general_uploads"("upload_id");

-- CreateIndex
CREATE UNIQUE INDEX "general_uploads_drive_folder_id_key" ON "general_uploads"("drive_folder_id");

-- CreateIndex
CREATE INDEX "general_uploads_clinic_id_date_idx" ON "general_uploads"("clinic_id", "date" DESC);

-- CreateIndex
CREATE INDEX "general_uploads_title_idx" ON "general_uploads" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "general_media_drive_file_id_key" ON "general_media"("drive_file_id");

-- CreateIndex
CREATE INDEX "general_media_general_upload_id_kind_idx" ON "general_media"("general_upload_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "general_media_general_upload_id_position_key" ON "general_media"("general_upload_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "general_media_general_upload_id_file_name_key" ON "general_media"("general_upload_id", "file_name");

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "share_views" ADD CONSTRAINT "share_views_share_link_id_fkey" FOREIGN KEY ("share_link_id") REFERENCES "share_links"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "general_uploads" ADD CONSTRAINT "general_uploads_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "general_media" ADD CONSTRAINT "general_media_general_upload_id_fkey" FOREIGN KEY ("general_upload_id") REFERENCES "general_uploads"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


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

ALTER TABLE clinics ADD CONSTRAINT clinic_counter_positive CHECK (next_patient_number > 0);
ALTER TABLE media ADD CONSTRAINT media_valid_size CHECK (bytes >= 0 AND position >= 0);
ALTER TABLE general_media ADD CONSTRAINT general_media_valid_size CHECK (bytes >= 0 AND position >= 0);
ALTER TABLE consent_events ADD CONSTRAINT consent_version_positive CHECK (consent_text_version > 0);
ALTER TABLE share_links ADD CONSTRAINT share_view_count_nonnegative CHECK (view_count >= 0);
ALTER TABLE share_links ADD CONSTRAINT share_expiry_after_creation CHECK (expires_at > created_at);
