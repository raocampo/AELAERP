-- Adds esTrial and trialExpiresAt to the tenants table in the master DB.
-- Safe to run multiple times (uses IF NOT EXISTS).

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "esTrial"        BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "trialExpiresAt" TIMESTAMP(3);
