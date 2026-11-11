-- Village Deactivation Workflow: request table, in-app notification table.
--
-- Additive only: no existing table, column or index is changed or dropped, so
-- it is safe to apply to a development database that already has data.
--
-- The last section (partial unique index and CHECK constraints) is written by
-- hand. Prisma cannot model it. After applying, run `npx prisma migrate diff`
-- (see the notes delivered with this change) and confirm Prisma does not want
-- to drop the partial index.
--
-- Timestamps are TIMESTAMP(3) without time zone, like every other table, and
-- hold UTC. Any SQL that writes them from the database clock must use
-- (now() AT TIME ZONE 'UTC'), not bare now(), or the value shifts by the
-- session time zone.

-- CreateEnum
CREATE TYPE "DeactivationRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('DEACTIVATION_REQUESTED', 'DEACTIVATION_APPROVED', 'DEACTIVATION_REJECTED', 'DEACTIVATION_CANCELLED', 'DEACTIVATION_COMPLETED', 'DEACTIVATION_REMINDER');

-- CreateTable
CREATE TABLE "VillageDeactivationRequest" (
    "id" TEXT NOT NULL,
    "villageId" TEXT NOT NULL,
    "requesterUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "DeactivationRequestStatus" NOT NULL DEFAULT 'PENDING',
    "rejectedByUserId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "cooldownEndsAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "scheduledDeactivationAt" TIMESTAMP(3),
    "cancelledByUserId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,
    "processingAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastProcessingError" TEXT,
    "lastProcessingAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VillageDeactivationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "villageId" TEXT,
    "requestId" TEXT,
    "type" "NotificationType" NOT NULL,
    "params" JSONB,
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VillageDeactivationRequest_status_scheduledDeactivationAt_idx" ON "VillageDeactivationRequest"("status", "scheduledDeactivationAt");

-- CreateIndex
CREATE INDEX "VillageDeactivationRequest_villageId_status_cooldownEndsAt_idx" ON "VillageDeactivationRequest"("villageId", "status", "cooldownEndsAt");

-- CreateIndex
CREATE INDEX "VillageDeactivationRequest_villageId_createdAt_idx" ON "VillageDeactivationRequest"("villageId", "createdAt");

-- CreateIndex
CREATE INDEX "VillageDeactivationRequest_requesterUserId_idx" ON "VillageDeactivationRequest"("requesterUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_requestId_idx" ON "Notification"("requestId");

-- AddForeignKey
ALTER TABLE "VillageDeactivationRequest" ADD CONSTRAINT "VillageDeactivationRequest_villageId_fkey" FOREIGN KEY ("villageId") REFERENCES "Village"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VillageDeactivationRequest" ADD CONSTRAINT "VillageDeactivationRequest_requesterUserId_fkey" FOREIGN KEY ("requesterUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VillageDeactivationRequest" ADD CONSTRAINT "VillageDeactivationRequest_rejectedByUserId_fkey" FOREIGN KEY ("rejectedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VillageDeactivationRequest" ADD CONSTRAINT "VillageDeactivationRequest_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VillageDeactivationRequest" ADD CONSTRAINT "VillageDeactivationRequest_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_villageId_fkey" FOREIGN KEY ("villageId") REFERENCES "Village"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "VillageDeactivationRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written: invariants Prisma cannot express.
-- ---------------------------------------------------------------------------

-- One unresolved (PENDING or APPROVED) request per village. REJECTED,
-- CANCELLED and COMPLETED rows are history and do not count. This is the
-- database-level backstop for "one unresolved request per village"; the
-- application checks first and relies on this under concurrency.
CREATE UNIQUE INDEX "VillageDeactivationRequest_villageId_unresolved_key"
  ON "VillageDeactivationRequest"("villageId")
  WHERE "status" IN ('PENDING', 'APPROVED');

-- Reasons are mandatory and must not be blank.
ALTER TABLE "VillageDeactivationRequest"
  ADD CONSTRAINT "VillageDeactivationRequest_reason_not_blank_check"
  CHECK (length(btrim("reason")) > 0);

ALTER TABLE "VillageDeactivationRequest"
  ADD CONSTRAINT "VillageDeactivationRequest_processingAttempts_check"
  CHECK ("processingAttempts" >= 0);

-- Which fields may be set in which status. A CHECK passes when it evaluates to
-- NULL, so every field that must be present is tested with IS NOT NULL
-- explicitly instead of relying on a comparison to fail.
--
-- The countdown is fixed: scheduledDeactivationAt = approvedAt + 24 hours
-- (Rules 4.1). It is stored once and never recalculated, and the CHECK keeps
-- any later write from moving it.

-- PENDING: no decision of any kind yet.
ALTER TABLE "VillageDeactivationRequest"
  ADD CONSTRAINT "VillageDeactivationRequest_pending_shape_check"
  CHECK (
    "status" <> 'PENDING' OR (
      "rejectedByUserId" IS NULL AND "rejectedAt" IS NULL
      AND "rejectionReason" IS NULL AND "cooldownEndsAt" IS NULL
      AND "approvedByUserId" IS NULL AND "approvedAt" IS NULL
      AND "scheduledDeactivationAt" IS NULL
      AND "cancelledByUserId" IS NULL AND "cancelledAt" IS NULL
      AND "cancellationReason" IS NULL
      AND "completedAt" IS NULL AND "completedBy" IS NULL
    )
  );

-- APPROVED: approval recorded, deadline exactly 24h later, nothing else.
ALTER TABLE "VillageDeactivationRequest"
  ADD CONSTRAINT "VillageDeactivationRequest_approved_shape_check"
  CHECK (
    "status" <> 'APPROVED' OR (
      "approvedByUserId" IS NOT NULL AND "approvedAt" IS NOT NULL
      AND "scheduledDeactivationAt" IS NOT NULL
      AND "scheduledDeactivationAt" = "approvedAt" + interval '24 hours'
      AND "rejectedByUserId" IS NULL AND "rejectedAt" IS NULL
      AND "rejectionReason" IS NULL AND "cooldownEndsAt" IS NULL
      AND "cancelledByUserId" IS NULL AND "cancelledAt" IS NULL
      AND "cancellationReason" IS NULL
      AND "completedAt" IS NULL AND "completedBy" IS NULL
    )
  );

-- REJECTED: who, when, why, and the cooldown end. Never approved.
ALTER TABLE "VillageDeactivationRequest"
  ADD CONSTRAINT "VillageDeactivationRequest_rejected_shape_check"
  CHECK (
    "status" <> 'REJECTED' OR (
      "rejectedByUserId" IS NOT NULL AND "rejectedAt" IS NOT NULL
      AND "rejectionReason" IS NOT NULL
      AND length(btrim("rejectionReason")) > 0
      AND "cooldownEndsAt" IS NOT NULL
      AND "cooldownEndsAt" >= "rejectedAt"
      AND "approvedByUserId" IS NULL AND "approvedAt" IS NULL
      AND "scheduledDeactivationAt" IS NULL
      AND "cancelledByUserId" IS NULL AND "cancelledAt" IS NULL
      AND "cancellationReason" IS NULL
      AND "completedAt" IS NULL AND "completedBy" IS NULL
    )
  );

-- CANCELLED: only an APPROVED request can be cancelled, so the approval and
-- the original deadline stay as history; cancellation happened strictly before
-- that deadline.
ALTER TABLE "VillageDeactivationRequest"
  ADD CONSTRAINT "VillageDeactivationRequest_cancelled_shape_check"
  CHECK (
    "status" <> 'CANCELLED' OR (
      "approvedByUserId" IS NOT NULL AND "approvedAt" IS NOT NULL
      AND "scheduledDeactivationAt" IS NOT NULL
      AND "scheduledDeactivationAt" = "approvedAt" + interval '24 hours'
      AND "cancelledByUserId" IS NOT NULL AND "cancelledAt" IS NOT NULL
      AND "cancellationReason" IS NOT NULL
      AND length(btrim("cancellationReason")) > 0
      AND "cancelledAt" >= "approvedAt"
      AND "cancelledAt" < "scheduledDeactivationAt"
      AND "rejectedByUserId" IS NULL AND "rejectedAt" IS NULL
      AND "rejectionReason" IS NULL AND "cooldownEndsAt" IS NULL
      AND "completedAt" IS NULL AND "completedBy" IS NULL
    )
  );

-- COMPLETED: approved, then finished at or after the original deadline by a
-- named actor (a user or a system process).
ALTER TABLE "VillageDeactivationRequest"
  ADD CONSTRAINT "VillageDeactivationRequest_completed_shape_check"
  CHECK (
    "status" <> 'COMPLETED' OR (
      "approvedByUserId" IS NOT NULL AND "approvedAt" IS NOT NULL
      AND "scheduledDeactivationAt" IS NOT NULL
      AND "scheduledDeactivationAt" = "approvedAt" + interval '24 hours'
      AND "completedAt" IS NOT NULL AND "completedBy" IS NOT NULL
      AND length(btrim("completedBy")) > 0
      AND "completedAt" >= "scheduledDeactivationAt"
      AND "rejectedByUserId" IS NULL AND "rejectedAt" IS NULL
      AND "rejectionReason" IS NULL AND "cooldownEndsAt" IS NULL
      AND "cancelledByUserId" IS NULL AND "cancelledAt" IS NULL
      AND "cancellationReason" IS NULL
    )
  );
