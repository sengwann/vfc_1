# Task 2 financial migration runbook

## Current status and permissions

Files only. No database has been accessed and no migration executed. Dependency
restoration, generated Prisma Client, typecheck, lint, build and integration tests
are deferred to the separately approved testing stage. Phase 2 alone cannot be
released: old writers use targetAmount and omit mandatory assessment links.

## Mandatory read-only production preflight

Obtain separate owner authorization and use a read-only role. Execute
scripts/fund-financial-preflight.sql with a client configured to stop on errors
(e.g. psql -X --set ON_ERROR_STOP=1 --file scripts/fund-financial-preflight.sql,
with connection credentials supplied securely, never committed or printed).
The script begins REPEATABLE READ READ ONLY and ends ROLLBACK. It performs no DDL.

Confirm the intended database/schema, PostgreSQL version, all eight prerequisite
migration names AND checksums against this checkout, completed state, no failures,
no unexpected migrations, objects or drift. Compare catalogs/schema to the old
migration chain, including existing partial indexes/checks. An absent expected
table, unexpected financial table or permission failure is a STOP, not an empty
result. All Fund rows (including DRAFT), Payment rows (including VOIDED), Receipt
rows and financial audit matches must be zero. Review ALL audit entity-type
counts: an unrecognized financial label or metadata representation requires
review. The automated conservative filter includes known entity types and
financial JSON keys; it cannot classify arbitrary free text.

Review returned invalid head/membership village relationships; STOP for review,
never repair automatically. The owner's report of no history is not evidence of
an empty database. Unexpected records require a separate data-policy review;
no deletion, inferred village targets, recalculation or backfill is authorized.

## Execution gates (separate future approval)

1. Finish all later financial writers and verify the exact release revision.
2. Run the complete eight-migration baseline and new migration in an authorized
   disposable PostgreSQL database. Exercise constraints, triggers and concurrent
   activation/payment/void/closure/lifecycle writes. Validate Prisma schema,
   regenerate Client, run typecheck (--incremental false), lint, unit tests/build.
3. Have independent testing (Qwen) inspect this exact revision. Static checks or
   mocked tests cannot establish PostgreSQL trigger correctness.
4. Verify full backup and rehearse restore, including users and unrelated data.
5. Stop ALL writers/workers and old app instances; keep reads available only if
   compatible. Verify preflight again immediately before deployment.
6. Review exact pending migrations. Do not blindly deploy if earlier migrations
   are pending: the historical KPay-removal migration is destructive.
7. Apply the reviewed migration with a dedicated migration role. New SQL uses an
   explicit transaction, 10-second lock timeout, and ACCESS EXCLUSIVE locks on
   Village/User/House/Fund/Payment/Receipt/AuditLog BEFORE its emptiness assertion.
   This prevents an old writer from inserting between the assertion and DDL.
8. A nonzero count, lock timeout or any SQL error means STOP. Do not mark a failed
   migration applied, reset, seed, modify history or retry without investigation.
9. Verify new foreign keys/checks, partial indexes, trigger definitions and the
   per-village lock rows. Review Prisma schema diff without deleting custom SQL.
10. Start only the completed new writers, verify staging/production smoke flows
    and audit output, then reopen financial writes. Never run old/new writers
    together. Do not deploy Phase 2 independently.

## Recovery

The new migration's DDL/assertion is transactional. A SQL failure rolls it back;
inspect actual catalog state and Prisma migration bookkeeping before any retry.
No down migration is provided. Before new financial writes, rollback still needs
reviewed schema/application recovery and owner approval. After any new records,
an old-application rollback is unsafe: prefer a reviewed forward fix. Restoring a
backup requires explicit approval and reconciliation of intervening operations.
Never delete records or disable integrity triggers as a rollback shortcut.

## Known review items

Same-village serialization and affected-Fund history checks still have costs.
Benchmark the documented workloads before production. All SQL is authored offline and must be
executed against PostgreSQL before it can be declared verified. Runtime role
privileges must prevent bypassing triggers. Migration tests require a database
creation role only on an explicitly disposable test server; production access is
never a substitute. Existing application type errors from renamed/required fields
must be resolved in the approved later phases, not masked with compatibility data.


## Corrected scoped-lock deployment checks

The read-only preflight directly checks VillageFinancialWriteLock and
FundFinancialValidationWork, plus the obsolete FundFinancialWriteLock name. Any
existing internal table before this migration means STOP for drift/partial
deployment review. The obsolete singleton is not created.

Verify one lock row for EVERY existing Village and automatic creation on a new
Village. Missing rows must raise VFC_SCOPE_MISSING; contention raises retryable
40001/VFC_SCOPE_BUSY_RETRY_TRANSACTION. Internal work rows must be empty after
successful commits and survive/roll back correctly around savepoints/early flushes.
Verify the deployment runtime role is not an owner, cannot CREATE in public or
modify either internal table, and has EXECUTE only on the acquisition entry point
among privileged helpers. Review explicit/default grants as well as PUBLIC grants.
Apply the runtime EXECUTE grant only with the actual approved role name; no role
or permission changes were executed during file preparation.

Phase 3 must integrate every transaction in the schema-design inventory. Existing
house.ts/Village locks are not automatically reordered by triggers. Preserve the
global daily receipt allocator and test its contention separately. Native tuple
waits can still precede a row trigger; fallback NOWAIT prevents waiting on a scope
while holding such a tuple, and whole-transaction retries remain mandatory.

New SQL retains BEGIN/COMMIT and the in-transaction pre-DDL history assertion.
Migration tests inject failure only into their in-memory SQL copy, after DDL and
before COMMIT, and inspect rollback. Never insert failure injection into release
SQL. Verify schema/Client including Receipt's composite uniqueness. Security,
performance and executable PostgreSQL correctness remain independently unverified.


## Executable runtime privilege gate (post-migration, separate authorization)

Repository inspection found no deployment role provisioning or runtime/migration
role separation. src/lib/prisma.ts and prisma.config.ts both consume DATABASE_URL;
README supplies only an example URL. No real production role can be inferred.
The deployment owner must identify the actual application and worker login roles
securely, provide a separate trusted migration owner, and configure grants before
opening writes. Do not print credentials or infer a role name from an example.

For EACH actual runtime login, execute scripts/fund-financial-privilege-assertions.sql
with ON_ERROR_STOP and vfc.runtime_role supplied through PGOPTIONS (see script).
The check is read-only and rolls back. It refuses missing identities, elevated or
reachable privileged roles, schema/database creation, protected-table ownership,
TRIGGER/TRUNCATE rights, internal table/column privileges, privileged helper
execution, unsafe helper configuration and session_replication_role SET rights.
Only the acquisition helper requires runtime EXECUTE. Grant it to the real role
using separately reviewed deployment SQL; no production role/grants are invented
here. Review all other SECURITY DEFINER functions/extensions/role administration
for indirect escalation, and ensure public is owned by a trusted non-runtime role.
Rerun this gate after grant/default-privilege or role-membership changes.

Restricted-role tests require an explicitly disposable server and
VFC_ALLOW_ROLE_TESTS=1 in addition to TEST_DATABASE_URL. The test identity needs
CREATE ROLE and permission to grant membership for SET ROLE. Random NOLOGIN test
roles and grants are created inside the fixture transaction and rolled back,
including on failed assertions. They are never deployment roles or credentials.
The test exercises the exact assertion body, detects an unsafe DELETE grant,
checks direct internal-table DML/SELECT/TRUNCATE denial, schema/trigger/replication
bypass denial, and completes activation/payment/receipt through a restricted role.
These tests have not run. Migration/concurrency database creation still requires
its separate existing VFC_ALLOW_MIGRATION_TESTS=1 opt-in.

Village lock metadata uses ON DELETE CASCADE only when its parent Village is
actually deleted. Fund/assessment/payment/receipt/extension references remain
restrictive. Runtime roles have no direct lock-record deletion privilege. Verify
empty-village cleanup, financial-reference refusal and missing-scope errors before
release; this does not authorize financial-history deletion.
