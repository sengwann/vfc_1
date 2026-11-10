-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SYSTEM_ADMIN', 'CHIEF', 'VILLAGER');

-- CreateEnum
CREATE TYPE "VillageStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED', 'REMOVED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('KPAY', 'CASH');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('ACTIVE', 'VOIDED');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AuditActionType" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE', 'APPROVE', 'REJECT', 'REMOVE', 'ASSIGN', 'VOID', 'ACCEPT', 'LOGIN', 'LOGOUT');

-- CreateEnum
CREATE TYPE "FundStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "LanguagePreference" AS ENUM ('EN', 'MY');

-- CreateTable
CREATE TABLE "Village" (
    "id" TEXT NOT NULL,
    "villageCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "VillageStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Village_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "villageId" TEXT,
    "houseId" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'VILLAGER',
    "membershipStatus" "MembershipStatus",
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "dateOfBirth" DATE,
    "kpayAccountName" TEXT,
    "kpayAccountNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "House" (
    "id" TEXT NOT NULL,
    "villageId" TEXT NOT NULL,
    "houseNumber" TEXT NOT NULL,
    "headOfHouseId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "House_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectorAssignment" (
    "id" TEXT NOT NULL,
    "villageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectorAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fund" (
    "id" TEXT NOT NULL,
    "villageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "targetAmount" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "FundStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "villageId" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "houseId" TEXT NOT NULL,
    "payerUserId" TEXT NOT NULL,
    "collectorUserId" TEXT,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "kpayTransactionId" VARCHAR(64),
    "kpaySenderName" TEXT,
    "kpaySenderAccount" TEXT,
    "kpayReceiverAccount" TEXT,
    "rejectionNote" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "villageId" TEXT NOT NULL,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "villageId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "raisedByUserId" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "description" TEXT NOT NULL,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "villageId" TEXT,
    "actorUserId" TEXT,
    "actionType" "AuditActionType" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "language" "LanguagePreference" NOT NULL DEFAULT 'EN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Village_villageCode_key" ON "Village"("villageCode");

-- CreateIndex
CREATE INDEX "Village_status_idx" ON "Village"("status");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE INDEX "User_villageId_idx" ON "User"("villageId");

-- CreateIndex
CREATE INDEX "User_houseId_idx" ON "User"("houseId");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_villageId_role_idx" ON "User"("villageId", "role");

-- CreateIndex
CREATE INDEX "User_villageId_membershipStatus_idx" ON "User"("villageId", "membershipStatus");

-- CreateIndex
CREATE INDEX "User_villageId_houseId_idx" ON "User"("villageId", "houseId");

-- CreateIndex
CREATE INDEX "User_villageId_dateOfBirth_idx" ON "User"("villageId", "dateOfBirth");

-- CreateIndex
CREATE UNIQUE INDEX "House_headOfHouseId_key" ON "House"("headOfHouseId");

-- CreateIndex
CREATE INDEX "House_villageId_idx" ON "House"("villageId");

-- CreateIndex
CREATE INDEX "House_isActive_idx" ON "House"("isActive");

-- CreateIndex
CREATE INDEX "House_villageId_isActive_idx" ON "House"("villageId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "House_villageId_houseNumber_key" ON "House"("villageId", "houseNumber");

-- CreateIndex
CREATE INDEX "CollectorAssignment_villageId_idx" ON "CollectorAssignment"("villageId");

-- CreateIndex
CREATE INDEX "CollectorAssignment_userId_idx" ON "CollectorAssignment"("userId");

-- CreateIndex
CREATE INDEX "CollectorAssignment_villageId_year_month_idx" ON "CollectorAssignment"("villageId", "year", "month");

-- CreateIndex
CREATE INDEX "CollectorAssignment_villageId_isActive_idx" ON "CollectorAssignment"("villageId", "isActive");

-- CreateIndex
CREATE INDEX "CollectorAssignment_villageId_year_month_isActive_idx" ON "CollectorAssignment"("villageId", "year", "month", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "CollectorAssignment_villageId_userId_year_month_key" ON "CollectorAssignment"("villageId", "userId", "year", "month");

-- CreateIndex
CREATE INDEX "Fund_villageId_idx" ON "Fund"("villageId");

-- CreateIndex
CREATE INDEX "Fund_status_idx" ON "Fund"("status");

-- CreateIndex
CREATE INDEX "Fund_villageId_status_idx" ON "Fund"("villageId", "status");

-- CreateIndex
CREATE INDEX "Fund_villageId_startDate_endDate_idx" ON "Fund"("villageId", "startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_kpayTransactionId_key" ON "Payment"("kpayTransactionId");

-- CreateIndex
CREATE INDEX "Payment_villageId_idx" ON "Payment"("villageId");

-- CreateIndex
CREATE INDEX "Payment_fundId_idx" ON "Payment"("fundId");

-- CreateIndex
CREATE INDEX "Payment_houseId_idx" ON "Payment"("houseId");

-- CreateIndex
CREATE INDEX "Payment_payerUserId_idx" ON "Payment"("payerUserId");

-- CreateIndex
CREATE INDEX "Payment_collectorUserId_idx" ON "Payment"("collectorUserId");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE INDEX "Payment_fundId_houseId_idx" ON "Payment"("fundId", "houseId");

-- CreateIndex
CREATE INDEX "Payment_fundId_houseId_status_idx" ON "Payment"("fundId", "houseId", "status");

-- CreateIndex
CREATE INDEX "Payment_villageId_status_idx" ON "Payment"("villageId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_receiptNumber_key" ON "Receipt"("receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_paymentId_key" ON "Receipt"("paymentId");

-- CreateIndex
CREATE INDEX "Receipt_villageId_idx" ON "Receipt"("villageId");

-- CreateIndex
CREATE INDEX "Receipt_status_idx" ON "Receipt"("status");

-- CreateIndex
CREATE INDEX "Receipt_villageId_status_idx" ON "Receipt"("villageId", "status");

-- CreateIndex
CREATE INDEX "Dispute_villageId_idx" ON "Dispute"("villageId");

-- CreateIndex
CREATE INDEX "Dispute_paymentId_idx" ON "Dispute"("paymentId");

-- CreateIndex
CREATE INDEX "Dispute_raisedByUserId_idx" ON "Dispute"("raisedByUserId");

-- CreateIndex
CREATE INDEX "Dispute_status_idx" ON "Dispute"("status");

-- CreateIndex
CREATE INDEX "Dispute_villageId_status_idx" ON "Dispute"("villageId", "status");

-- CreateIndex
CREATE INDEX "Dispute_paymentId_status_idx" ON "Dispute"("paymentId", "status");

-- CreateIndex
CREATE INDEX "Dispute_villageId_createdAt_idx" ON "Dispute"("villageId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_villageId_idx" ON "AuditLog"("villageId");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId");

-- CreateIndex
CREATE INDEX "AuditLog_actionType_idx" ON "AuditLog"("actionType");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_idx" ON "AuditLog"("entityType");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_villageId_createdAt_idx" ON "AuditLog"("villageId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_villageId_actionType_idx" ON "AuditLog"("villageId", "actionType");

-- CreateIndex
CREATE UNIQUE INDEX "UserSettings_userId_key" ON "UserSettings"("userId");

-- CreateIndex
CREATE INDEX "UserSettings_userId_idx" ON "UserSettings"("userId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_villageId_fkey" FOREIGN KEY ("villageId") REFERENCES "Village"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "House"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "House" ADD CONSTRAINT "House_villageId_fkey" FOREIGN KEY ("villageId") REFERENCES "Village"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "House" ADD CONSTRAINT "House_headOfHouseId_fkey" FOREIGN KEY ("headOfHouseId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectorAssignment" ADD CONSTRAINT "CollectorAssignment_villageId_fkey" FOREIGN KEY ("villageId") REFERENCES "Village"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectorAssignment" ADD CONSTRAINT "CollectorAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fund" ADD CONSTRAINT "Fund_villageId_fkey" FOREIGN KEY ("villageId") REFERENCES "Village"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_villageId_fkey" FOREIGN KEY ("villageId") REFERENCES "Village"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "House"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_payerUserId_fkey" FOREIGN KEY ("payerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_collectorUserId_fkey" FOREIGN KEY ("collectorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_villageId_fkey" FOREIGN KEY ("villageId") REFERENCES "Village"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_villageId_fkey" FOREIGN KEY ("villageId") REFERENCES "Village"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_raisedByUserId_fkey" FOREIGN KEY ("raisedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_villageId_fkey" FOREIGN KEY ("villageId") REFERENCES "Village"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
