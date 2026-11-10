-- READ ONLY. Execute only after separate owner authorization, with a read-only
-- role. Review every result; this script does not approve migration execution.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = public, pg_catalog;
SELECT current_database() AS database, current_schema() AS schema,
  current_user AS role, version() AS postgres_version;
SELECT migration_name, checksum, started_at, finished_at, rolled_back_at,
  applied_steps_count FROM "_prisma_migrations" ORDER BY migration_name;
SELECT 'Fund' AS entity, count(*) FROM "Fund"
UNION ALL SELECT 'Payment', count(*) FROM "Payment"
UNION ALL SELECT 'Receipt', count(*) FROM "Receipt";
SELECT "entityType", count(*) FROM "AuditLog" GROUP BY "entityType" ORDER BY "entityType";
SELECT id, "entityType", "entityId" FROM "AuditLog"
WHERE upper("entityType") IN ('FUND','PAYMENT','RECEIPT','FUND_HOUSE_ASSESSMENT','FUND_END_DATE_EXTENSION')
 OR "metadata"::text ~* '"(fundId|paymentId|receiptId|assessmentId|villageTargetAmount|targetAmount|totalAmount)"\s*:';
SELECT to_regclass('public."FundHouseAssessment"') AS unexpected_assessment_table,
  to_regclass('public."FundEndDateExtension"') AS unexpected_extension_table,
  to_regclass('public."FundFinancialWriteLock"') AS obsolete_lock_table,
  to_regclass('public."VillageFinancialWriteLock"') AS unexpected_village_lock_table,
  to_regclass('public."FundFinancialValidationWork"') AS unexpected_validation_work_table;
SELECT h.id AS house_with_invalid_head FROM "House" h LEFT JOIN "User" u ON u.id=h."headOfHouseId"
WHERE h."headOfHouseId" IS NOT NULL AND (u.id IS NULL OR u."houseId" IS DISTINCT FROM h.id
  OR u."villageId" IS DISTINCT FROM h."villageId" OR u."membershipStatus" IS DISTINCT FROM 'ACTIVE');
SELECT u.id AS member_with_mismatched_village FROM "User" u JOIN "House" h ON h.id=u."houseId"
WHERE u."villageId" IS DISTINCT FROM h."villageId";
ROLLBACK;
