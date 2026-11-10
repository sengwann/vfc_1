/*
  Warnings:

  - The values [PENDING,REJECTED] on the enum `PaymentStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `kpayReceiverAccount` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the column `kpaySenderAccount` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the column `kpaySenderName` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the column `kpayTransactionId` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the column `paymentMethod` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the column `rejectionNote` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the column `kpayAccountName` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `kpayAccountNumber` on the `User` table. All the data in the column will be lost.
  - You are about to drop the `Dispute` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "PaymentStatus_new" AS ENUM ('ACCEPTED', 'VOIDED');
ALTER TABLE "public"."Payment" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Payment" ALTER COLUMN "status" TYPE "PaymentStatus_new" USING ("status"::text::"PaymentStatus_new");
ALTER TYPE "PaymentStatus" RENAME TO "PaymentStatus_old";
ALTER TYPE "PaymentStatus_new" RENAME TO "PaymentStatus";
DROP TYPE "public"."PaymentStatus_old";
ALTER TABLE "Payment" ALTER COLUMN "status" SET DEFAULT 'ACCEPTED';
COMMIT;

-- DropForeignKey
ALTER TABLE "Dispute" DROP CONSTRAINT "Dispute_paymentId_fkey";

-- DropForeignKey
ALTER TABLE "Dispute" DROP CONSTRAINT "Dispute_raisedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "Dispute" DROP CONSTRAINT "Dispute_villageId_fkey";

-- DropIndex
DROP INDEX "Payment_kpayTransactionId_key";

-- AlterTable
ALTER TABLE "Payment" DROP COLUMN "kpayReceiverAccount",
DROP COLUMN "kpaySenderAccount",
DROP COLUMN "kpaySenderName",
DROP COLUMN "kpayTransactionId",
DROP COLUMN "paymentMethod",
DROP COLUMN "rejectionNote",
ALTER COLUMN "status" SET DEFAULT 'ACCEPTED';

-- AlterTable
ALTER TABLE "User" DROP COLUMN "kpayAccountName",
DROP COLUMN "kpayAccountNumber";

-- DropTable
DROP TABLE "Dispute";

-- DropEnum
DROP TYPE "DisputeStatus";

-- DropEnum
DROP TYPE "PaymentMethod";
