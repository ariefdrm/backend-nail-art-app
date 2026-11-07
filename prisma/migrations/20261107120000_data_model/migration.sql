-- Required for the EXCLUDE constraint below (uuid equality inside a GiST index).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateEnum
CREATE TYPE "booking_status" AS ENUM ('pending', 'confirmed', 'completed', 'cancelled', 'no_show');

-- CreateEnum
CREATE TYPE "booking_source" AS ENUM ('online', 'admin');

-- CreateEnum
CREATE TYPE "admin_role" AS ENUM ('owner', 'staff');

-- Replace the earlier users/refresh_tokens tables (not released, no data to keep).
DROP TABLE "refresh_tokens";
DROP TABLE "users";

-- CreateTable
CREATE TABLE "admins" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "admin_role" NOT NULL DEFAULT 'owner',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "image_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artists" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(80) NOT NULL,
    "photo_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "artists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_code" VARCHAR(20) NOT NULL,
    "status" "booking_status" NOT NULL DEFAULT 'pending',
    "source" "booking_source" NOT NULL DEFAULT 'online',
    "service_id" UUID NOT NULL,
    "artist_id" UUID NOT NULL,
    "start_at" TIMESTAMPTZ(3) NOT NULL,
    "end_at" TIMESTAMPTZ(3) NOT NULL,
    "customer_name" VARCHAR(100) NOT NULL,
    "customer_phone" VARCHAR(20) NOT NULL,
    "customer_note" VARCHAR(500),
    "reference_image_url" TEXT,
    "total_price" INTEGER NOT NULL,
    "cancel_reason" VARCHAR(255),
    "admin_note" TEXT,
    "confirmed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "from_status" "booking_status",
    "to_status" "booking_status" NOT NULL,
    "changed_by" UUID,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" VARCHAR(255),

    CONSTRAINT "booking_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_hours" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "day_of_week" SMALLINT NOT NULL,
    "is_open" BOOLEAN NOT NULL,
    "open_time" VARCHAR(5),
    "close_time" VARCHAR(5),
    "break_start" VARCHAR(5),
    "break_end" VARCHAR(5),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "business_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocked_slots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "artist_id" UUID,
    "start_at" TIMESTAMPTZ(3) NOT NULL,
    "end_at" TIMESTAMPTZ(3) NOT NULL,
    "reason" VARCHAR(255),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "blocked_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "user_agent" TEXT,
    "ip_address" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- CreateIndex
CREATE INDEX "services_is_active_category_idx" ON "services"("is_active", "category");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_booking_code_key" ON "bookings"("booking_code");

-- CreateIndex
CREATE INDEX "bookings_artist_id_start_at_idx" ON "bookings"("artist_id", "start_at");

-- CreateIndex
CREATE INDEX "bookings_start_at_idx" ON "bookings"("start_at");

-- CreateIndex
CREATE INDEX "bookings_status_idx" ON "bookings"("status");

-- CreateIndex
CREATE INDEX "bookings_customer_phone_idx" ON "bookings"("customer_phone");

-- CreateIndex
CREATE INDEX "booking_status_history_booking_id_changed_at_idx" ON "booking_status_history"("booking_id", "changed_at");

-- CreateIndex
CREATE UNIQUE INDEX "business_hours_day_of_week_key" ON "business_hours"("day_of_week");

-- CreateIndex
CREATE INDEX "blocked_slots_start_at_end_at_idx" ON "blocked_slots"("start_at", "end_at");

-- CreateIndex
CREATE INDEX "blocked_slots_artist_id_idx" ON "blocked_slots"("artist_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_admin_id_idx" ON "refresh_tokens"("admin_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "artists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocked_slots" ADD CONSTRAINT "blocked_slots_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "artists"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Constraints Prisma cannot express (hand-written; keep when regenerating)
-- ---------------------------------------------------------------------------

-- Anti double booking: the same artist cannot have two overlapping active
-- bookings. Ranges are half-open, so end_at = start_at is allowed.
-- Violations raise SQLSTATE 23P01, which the app maps to 409 SLOT_UNAVAILABLE.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist (
    "artist_id" WITH =,
    tstzrange("start_at", "end_at", '[)') WITH &&
  )
  WHERE ("status" IN ('pending', 'confirmed'));

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_time_order_check" CHECK ("end_at" > "start_at"),
  ADD CONSTRAINT "bookings_total_price_check" CHECK ("total_price" >= 0);

ALTER TABLE "blocked_slots"
  ADD CONSTRAINT "blocked_slots_time_order_check" CHECK ("end_at" > "start_at");

ALTER TABLE "services"
  ADD CONSTRAINT "services_price_check" CHECK ("price" >= 0),
  ADD CONSTRAINT "services_duration_check" CHECK ("duration_minutes" > 0 AND "duration_minutes" % 15 = 0);

-- business_hours: times are "HH:mm" strings in Asia/Jakarta, so they compare lexically.
ALTER TABLE "business_hours"
  ADD CONSTRAINT "business_hours_day_check" CHECK ("day_of_week" BETWEEN 0 AND 6),
  ADD CONSTRAINT "business_hours_format_check" CHECK (
    ("open_time"   IS NULL OR "open_time"   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') AND
    ("close_time"  IS NULL OR "close_time"  ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') AND
    ("break_start" IS NULL OR "break_start" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') AND
    ("break_end"   IS NULL OR "break_end"   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
  ),
  ADD CONSTRAINT "business_hours_open_check" CHECK (
    NOT "is_open" OR ("open_time" IS NOT NULL AND "close_time" IS NOT NULL AND "open_time" < "close_time")
  ),
  ADD CONSTRAINT "business_hours_break_check" CHECK (
    ("break_start" IS NULL AND "break_end" IS NULL) OR
    ("is_open" AND "break_start" IS NOT NULL AND "break_end" IS NOT NULL
      AND "break_start" < "break_end" AND "break_start" >= "open_time" AND "break_end" <= "close_time")
  );
