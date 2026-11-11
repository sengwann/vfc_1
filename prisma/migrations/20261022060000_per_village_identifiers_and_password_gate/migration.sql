-- B02 / B01 / B03: per-village email and phone uniqueness, plus the
-- "must change password" flag used for newly created Chief accounts.
--
-- DESTRUCTIVE (owner approved): drops the two global unique indexes
-- "User_email_key" and "User_phone_key". No rows are deleted. They are
-- replaced by village-scoped unique indexes below.
--
-- Prisma cannot model the two partial unique indexes at the end of this file
-- (WHERE clauses). They are written by hand on purpose. After applying, run
-- `npx prisma migrate diff` (see the notes delivered with this change) and
-- confirm Prisma does not want to drop them.

-- Phone numbers now have ONE stored format: Myanmar numbers written as
-- +959..., 959... or 00959... are stored as 09... (same rule as the app's
-- normalizePhone). Existing rows are converted so login keeps matching them.
-- Abort (nothing is applied) if the conversion would make two accounts in the
-- same village share a number, so a human can resolve it first.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT
        "villageId",
        CASE
          WHEN "phone" ~ '^(\+|00)?959[0-9]{7,9}$'
            THEN '0' || substring("phone" from '^(?:\+|00)?95(9[0-9]{7,9})$')
          ELSE "phone"
        END AS "normalizedPhone"
      FROM "User"
      WHERE "phone" IS NOT NULL
    ) AS "converted"
    GROUP BY "villageId", "normalizedPhone"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Phone normalization would create duplicate phone numbers within one village. Resolve the duplicates, then apply this migration again.';
  END IF;
END
$$;

UPDATE "User"
SET "phone" = '0' || substring("phone" from '^(?:\+|00)?95(9[0-9]{7,9})$')
WHERE "phone" ~ '^(\+|00)?959[0-9]{7,9}$';

-- AlterTable: no existing account is forced to change its password.
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- DropIndex
DROP INDEX "User_email_key";

-- DropIndex
DROP INDEX "User_phone_key";

-- CreateIndex: unique per village. A NULL villageId never conflicts here, so
-- SYSTEM_ADMIN accounts are covered by the partial indexes below.
CREATE UNIQUE INDEX "User_villageId_email_key" ON "User"("villageId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "User_villageId_phone_key" ON "User"("villageId", "phone");

-- CreateIndex (partial): SYSTEM_ADMIN accounts have no village. Keep their
-- email and phone unique among themselves.
CREATE UNIQUE INDEX "User_admin_email_key" ON "User"("email")
  WHERE "villageId" IS NULL AND "email" IS NOT NULL;

-- CreateIndex (partial)
CREATE UNIQUE INDEX "User_admin_phone_key" ON "User"("phone")
  WHERE "villageId" IS NULL AND "phone" IS NOT NULL;