-- Password recovery, step 1 of 2: the new notification types.
--
-- Additive only: four values are added to the "NotificationType" enum. Nothing
-- existing is changed or dropped.
--
-- This is its own migration on purpose. PostgreSQL does not let a transaction
-- use an enum value that was added in the same transaction, and the next
-- migration (password_recovery) has a CHECK constraint that mentions these
-- types. Keeping them apart guarantees the values are committed first.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'RECOVERY_REQUESTED';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'RECOVERY_REJECTED';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'RECOVERY_PASSWORD_CHANGED';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'RECOVERY_RESET_COMPLETED';
