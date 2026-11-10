-- AlterEnum
ALTER TYPE "AuditActionType" ADD VALUE 'LOGIN_THROTTLED';

-- CreateTable
CREATE TABLE "LoginThrottleState" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoginThrottleState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoginThrottleState_updatedAt_idx" ON "LoginThrottleState"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LoginThrottleState_scope_keyHash_key" ON "LoginThrottleState"("scope", "keyHash");
