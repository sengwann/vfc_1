-- Password recovery, step 2 of 2: the request table and its link from
-- Notification.
--
-- Additive only: one enum, one table, one new nullable column on
-- "Notification". No existing row, column or index is changed or dropped, so it
-- is safe to apply to a development database that already has data. Existing
-- notifications keep "recoveryRequestId" = NULL and satisfy the new CHECK.
--
-- The last section (partial unique index and CHECK constraints) is written by
-- hand. Prisma cannot model it. After applying, run `npx prisma migrate diff`
-- and confirm Prisma does not want to drop the partial index.
--
-- Timestamps are TIMESTAMP(3) without time zone and hold UTC. Any SQL that
-- writes them from the database clock must use (now() AT TIME ZONE 'UTC'),
-- not bare now(), or the value shifts by the session time zone.

-- CreateEnum
CREATE TYPE "PasswordRecoveryStatus" AS ENUM ('PENDING', 'CODE_ISSUED', 'COMPLETED', 'REJECTED', 'EXPIRED', 'REVOKED');

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "recoveryRequestId" TEXT;

-- CreateTable
CREATE TABLE "PasswordRecoveryRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "villageId" TEXT,
    "status" "PasswordRecoveryStatus" NOT NULL DEFAULT 'PENDING',
    "requestExpiresAt" TIMESTAMP(3) NOT NULL,
    "codeHash" TEXT,
    "codeIssuedAt" TIMESTAMP(3),
    "codeExpiresAt" TIMESTAMP(3),
    "codeIssuedByUserId" TEXT,
    "issueCount" INTEGER NOT NULL DEFAULT 0,
    "failedRedeemAttempts" INTEGER NOT NULL DEFAULT 0,
    "rejectedByUserId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionNote" TEXT,
    "revocationReason" TEXT,
    "revokedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revocationNote" TEXT,
    "expiredAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PasswordRecoveryRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PasswordRecoveryRequest_status_requestExpiresAt_idx" ON "PasswordRecoveryRequest"("status", "requestExpiresAt");

-- CreateIndex
CREATE INDEX "PasswordRecoveryRequest_villageId_status_idx" ON "PasswordRecoveryRequest"("villageId", "status");

-- CreateIndex
CREATE INDEX "PasswordRecoveryRequest_userId_createdAt_idx" ON "PasswordRecoveryRequest"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_recoveryRequestId_idx" ON "Notification"("recoveryRequestId");

-- AddForeignKey
ALTER TABLE "PasswordRecoveryRequest" ADD CONSTRAINT "PasswordRecoveryRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordRecoveryRequest" ADD CONSTRAINT "PasswordRecoveryRequest_villageId_fkey" FOREIGN KEY ("villageId") REFERENCES "Village"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordRecoveryRequest" ADD CONSTRAINT "PasswordRecoveryRequest_codeIssuedByUserId_fkey" FOREIGN KEY ("codeIssuedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordRecoveryRequest" ADD CONSTRAINT "PasswordRecoveryRequest_rejectedByUserId_fkey" FOREIGN KEY ("rejectedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordRecoveryRequest" ADD CONSTRAINT "PasswordRecoveryRequest_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recoveryRequestId_fkey" FOREIGN KEY ("recoveryRequestId") REFERENCES "PasswordRecoveryRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written: invariants Prisma cannot express.
-- ---------------------------------------------------------------------------

-- One active (PENDING or CODE_ISSUED) request per user. COMPLETED, REJECTED,
-- EXPIRED and REVOKED rows are history and do not count. It is per user, not
-- per email or phone, so filing with the other identifier cannot create a
-- second one. This is the database backstop for "one active request"; the
-- application checks first and relies on this under concurrency.
CREATE UNIQUE INDEX "PasswordRecoveryRequest_userId_active_key"
  ON "PasswordRecoveryRequest"("userId")
  WHERE "status" IN ('PENDING', 'CODE_ISSUED');

-- Counters never go negative; the request outlives its creation time.
ALTER TABLE "PasswordRecoveryRequest"
  ADD CONSTRAINT "PasswordRecoveryRequest_counters_check"
  CHECK ("issueCount" >= 0 AND "failedRedeemAttempts" >= 0);

ALTER TABLE "PasswordRecoveryRequest"
  ADD CONSTRAINT "PasswordRecoveryRequest_request_expiry_check"
  CHECK ("requestExpiresAt" > "createdAt");

-- The stored code hash is HMAC-SHA-256 in lowercase hex: exactly 64 characters
-- of 0-9a-f. A raw reset code (short, upper case, with letters outside a-f)
-- cannot be stored by mistake.
ALTER TABLE "PasswordRecoveryRequest"
  ADD CONSTRAINT "PasswordRecoveryRequest_code_hash_format_check"
  CHECK ("codeHash" IS NULL OR "codeHash" ~ '^[0-9a-f]{64}$');

-- Notes are optional, but when present they are not blank and at most 200
-- characters.
ALTER TABLE "PasswordRecoveryRequest"
  ADD CONSTRAINT "PasswordRecoveryRequest_notes_check"
  CHECK (
    ("rejectionNote" IS NULL
      OR (length(btrim("rejectionNote")) > 0 AND char_length("rejectionNote") <= 200))
    AND ("revocationNote" IS NULL
      OR (length(btrim("revocationNote")) > 0 AND char_length("revocationNote") <= 200))
  );

ALTER TABLE "PasswordRecoveryRequest"
  ADD CONSTRAINT "PasswordRecoveryRequest_revocation_reason_check"
  CHECK (
    "revocationReason" IS NULL
    OR "revocationReason" IN ('WITHDRAWN', 'TOO_MANY_ATTEMPTS', 'TARGET_INELIGIBLE')
  );

-- Code fields travel together: either a code was issued (time, expiry, issuer
-- and a count of at least 1 are all present) or none of them is. The code
-- expires strictly after it was issued. The hash itself is separate: it is
-- cleared when the request leaves CODE_ISSUED while the history stays.
ALTER TABLE "PasswordRecoveryRequest"
  ADD CONSTRAINT "PasswordRecoveryRequest_code_fields_check"
  CHECK (
    ("codeIssuedAt" IS NULL) = ("codeExpiresAt" IS NULL)
    AND ("codeIssuedAt" IS NULL) = ("codeIssuedByUserId" IS NULL)
    AND ("codeIssuedAt" IS NULL) = ("issueCount" = 0)
    AND ("codeIssuedAt" IS NULL OR "codeExpiresAt" > "codeIssuedAt")
  );

-- Which fields may be set in which status. A CHECK passes when it evaluates to
-- NULL, so every field that must be present is tested with IS NOT NULL
-- explicitly instead of relying on a comparison to fail.

-- PENDING: no code, no decision of any kind yet.
ALTER TABLE "PasswordRecoveryRequest"
  ADD CONSTRAINT "PasswordRecoveryRequest_pending_shape_check"
  CHECK (
    "status" <> 'PENDING' OR (
      "codeHash" IS NULL AND "codeIssuedAt" IS NULL
      AND "failedRedeemAttempts" = 0
      AND "rejectedByUserId" IS NULL AND "rejectedAt" IS NULL
      AND "rejectionNote" IS NULL
      AND "revocationReason" IS NULL AND "revokedByUserId" IS NULL
      AND "revokedAt" IS NULL AND "revocationNote" IS NULL
      AND "expiredAt" IS NULL AND "completedAt" IS NULL
    )
  );

-- CODE_ISSUED: a live code (hash present) and nothing else decided.
ALTER TABLE "PasswordRecoveryRequest"
  ADD CONSTRAINT "PasswordRecoveryRequest_code_issued_shape_check"
  CHECK (
    "status" <> 'CODE_ISSUED' OR (
      "codeHash" IS NOT NULL AND "codeIssuedAt" IS NOT NULL
      AND "rejectedByUserId" IS NULL AND "rejectedAt" IS NULL
      AND "rejectionNote" IS NULL
      AND "revocationReason" IS NULL AND "revokedByUserId" IS NULL
      AND "revokedAt" IS NULL AND "revocationNote" IS NULL
      AND "expiredAt" IS NULL AND "completedAt" IS NULL
    )
  );

-- COMPLETED: the hash is cleared (the code is dead), a code had been issued,
-- and completion happened after issuance and not after the code expired. The
-- last rule means an expired code can never complete, even by a buggy write.
ALTER TABLE "PasswordRecoveryRequest"
  ADD CONSTRAINT "PasswordRecoveryRequest_completed_shape_check"
  CHECK (
    "status" <> 'COMPLETED' OR (
      "codeHash" IS NULL
      AND "codeIssuedAt" IS NOT NULL AND "completedAt" IS NOT NULL
      AND "completedAt" >= "codeIssuedAt"
      AND "completedAt" <= "codeExpiresAt"
      AND "rejectedByUserId" IS NULL AND "rejectedAt" IS NULL
      AND "rejectionNote" IS NULL
      AND "revocationReason" IS NULL AND "revokedByUserId" IS NULL
      AND "revokedAt" IS NULL AND "revocationNote" IS NULL
      AND "expiredAt" IS NULL
    )
  );

-- REJECTED: only a PENDING request can be rejected, so no code ever existed.
ALTER TABLE "PasswordRecoveryRequest"
  ADD CONSTRAINT "PasswordRecoveryRequest_rejected_shape_check"
  CHECK (
    "status" <> 'REJECTED' OR (
      "rejectedByUserId" IS NOT NULL AND "rejectedAt" IS NOT NULL
      AND "codeHash" IS NULL AND "codeIssuedAt" IS NULL
      AND "revocationReason" IS NULL AND "revokedByUserId" IS NULL
      AND "revokedAt" IS NULL AND "revocationNote" IS NULL
      AND "expiredAt" IS NULL AND "completedAt" IS NULL
    )
  );

-- EXPIRED: from PENDING (no code) or from CODE_ISSUED (code history stays);
-- either way the hash is cleared and expiry is recorded at or after the
-- instant it was due.
ALTER TABLE "PasswordRecoveryRequest"
  ADD CONSTRAINT "PasswordRecoveryRequest_expired_shape_check"
  CHECK (
    "status" <> 'EXPIRED' OR (
      "expiredAt" IS NOT NULL
      AND "expiredAt" >= COALESCE("codeExpiresAt", "requestExpiresAt")
      AND "codeHash" IS NULL
      AND "rejectedByUserId" IS NULL AND "rejectedAt" IS NULL
      AND "rejectionNote" IS NULL
      AND "revocationReason" IS NULL AND "revokedByUserId" IS NULL
      AND "revokedAt" IS NULL AND "revocationNote" IS NULL
      AND "completedAt" IS NULL
    )
  );

-- REVOKED: a reason is always recorded and the hash is cleared. WITHDRAWN is
-- done by a named authority, needs a note, and only applies once a code was
-- issued. TOO_MANY_ATTEMPTS and TARGET_INELIGIBLE are done by the system, so
-- no user and no note; TOO_MANY_ATTEMPTS needs a code and at least one wrong
-- guess.
ALTER TABLE "PasswordRecoveryRequest"
  ADD CONSTRAINT "PasswordRecoveryRequest_revoked_shape_check"
  CHECK (
    "status" <> 'REVOKED' OR (
      "revokedAt" IS NOT NULL AND "revocationReason" IS NOT NULL
      AND "codeHash" IS NULL
      AND ("revocationReason" = 'WITHDRAWN') = ("revokedByUserId" IS NOT NULL)
      AND ("revocationReason" = 'WITHDRAWN' OR "revocationNote" IS NULL)
      AND ("revocationReason" <> 'WITHDRAWN'
           OR ("revocationNote" IS NOT NULL AND "codeIssuedAt" IS NOT NULL))
      AND ("revocationReason" <> 'TOO_MANY_ATTEMPTS'
           OR ("codeIssuedAt" IS NOT NULL AND "failedRedeemAttempts" >= 1))
      AND "rejectedByUserId" IS NULL AND "rejectedAt" IS NULL
      AND "rejectionNote" IS NULL
      AND "expiredAt" IS NULL AND "completedAt" IS NULL
    )
  );

-- A notification links to exactly one family of request. RECOVERY_* types must
-- use "recoveryRequestId" and leave "requestId" empty; every other type must
-- leave "recoveryRequestId" empty. Rows that already exist (all deactivation
-- types, "recoveryRequestId" NULL) satisfy this. Any future RECOVERY_* type is
-- covered by the prefix test and needs no change here.
ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_link_family_check"
  CHECK (
    (left("type"::text, 9) = 'RECOVERY_'
      AND "recoveryRequestId" IS NOT NULL AND "requestId" IS NULL)
    OR (left("type"::text, 9) <> 'RECOVERY_' AND "recoveryRequestId" IS NULL)
  );
