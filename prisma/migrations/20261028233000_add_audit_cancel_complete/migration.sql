-- AlterEnum
--
-- Village Deactivation Workflow: two new audit action types.
--
-- This is its own migration on purpose. PostgreSQL cannot use a newly added
-- enum value in the same transaction that adds it, and the next migration
-- (village_deactivation) is the first one that will need these values to be
-- usable. Nothing in this file reads or writes them.
ALTER TYPE "AuditActionType" ADD VALUE 'CANCEL';
ALTER TYPE "AuditActionType" ADD VALUE 'COMPLETE';
