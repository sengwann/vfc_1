# Task 2 Phase 2 database contract — corrected design

Specification v1.0. Files authored offline: no executable verification has run.
Phase 1's six files remain byte-for-byte unchanged. Phase 2 cannot deploy alone.

## Financial storage and invariants

One integer unit is one MMK. Village target retains Phase 1's project cap of
1,000,000,000; assessments/payments are 1..10,000,000. SQL ceiling arithmetic uses
bigint intermediates. DRAFT has no snapshot; ACTIVE/CLOSED require frozen count,
assessment and snapshot time. Reports derive assessment totals/surplus and accepted
collection/remaining/excess separately; aggregate bigint conversion must be safe.
Receipt retains unique paymentId and additionally declares the composite unique
(paymentId,villageId) for its Prisma one-to-one composite relation.

Assessment/Fund/House and Payment/assessment and Receipt/Payment composite FKs
preserve tenant identity. Payment actor membership is checked when created, not
frozen through a current-membership FK. Identity and amount edits are prohibited;
void keeps history and allows a new replacement record. One accepted payment per
fund/house and one ACTIVE fund per village have partial unique indexes. Every
Payment requires a matching-status Receipt by transaction end.

Activate by inserting the complete eligible assessment set while DRAFT, then
changing to ACTIVE with count, ceiling amount, snapshotAt and version+1. Eligible
means active House with an ACTIVE member in the same Village. Commit checks both
directions of equality and valid heads. No subsequent assessment insert/edit/delete
is allowed; new houses participate only in the next Fund. House number snapshots
retain display identity despite later renumbering.

ACTIVE terms are frozen. Extend only after Yangon expiry, with unpaid assessments,
a village Chief, reason and increasing date/version. Insert extension history
before updating Fund in the same transaction. One extension per transaction; do
not combine extension and closure. Close only after every assessment has an
ACCEPTED payment, with Chief/time/version+1. CLOSED cannot reopen or mutate its
financial records. Financial audit entries are append-only; later application
writers must create audit events atomically. Triggers do not authenticate callers.

Assessed houses remain active with an ACTIVE head in that house/village while
Fund is ACTIVE, even after payment. Valid head replacement can have temporary
intermediate states inside a transaction; ordinary member departure is allowed.
Village suspension/deactivation approval is blocked while any Fund is ACTIVE.

## Per-village locking protocol (mandatory Phase 3 integration)

VillageFinancialWriteLock has one exact-key row per Village, no global singleton.
The migration backfills existing villages. An AFTER INSERT Village trigger creates
new rows before the enqueue trigger. The internal row cascades on parent Village
deletion; actual financial foreign keys remain restrictive. Missing rows fail
with P0001/VFC_SCOPE_MISSING;
there is no lazy creation or silent fallback during financial writes.

vfc_acquire_villages(text[]) sorts/deduplicates non-null IDs, SELECTs each row FOR
UPDATE NOWAIT and increments revision. 55P03 contention is converted to
40001/VFC_SCOPE_BUSY_RETRY_TRANSACTION. Stale RR/SERIALIZABLE snapshots also fail
with native 40001 rather than validating an old snapshot. Locks last until
transaction end; revision changes and locks acquired after savepoints roll back
according to PostgreSQL subtransaction semantics.

Order: all Village scopes (sorted) -> Village rows -> Fund rows -> House rows ->
User/CollectorAssignment rows -> Payment rows -> daily receipt allocator ->
Receipt rows -> append audit. Sort IDs in each category; never return to an earlier
category. Phase 3 must acquire scopes BEFORE guardVillageWrite (Village FOR SHARE)
and lockHouse (FOR NO KEY UPDATE), before reading eligibility/authorization.

BEFORE row triggers provide a NOWAIT acquisition fallback for old/direct writers.
They may already hold a tuple lock; NOWAIT avoids waiting for a scope held by a
transaction waiting for that tuple. It does not promise that arbitrary SQL never
waits for a tuple before reaching the trigger. Explicit row-locking callers must
adopt the entry protocol. Retry the whole transaction for 40001/40P01 with bounded
retries, never only the failed statement. Existing retry/error translation must be
verified against raw pg and Prisma adapter forms in Phase 3.

Covered: financial records; House eligibility/head/number/identity; User creation,
deletion and changes to membership/house/village/role/identity; Village status/
identity; assignments; deactivation status/village changes. Password/profile/
session updates and worker lease bookkeeping do not acquire financial scopes.
AuditLog has no serialization trigger; entity/village matching and append-only
history remain enforced. Same-village relevant writes still serialize deliberately.

## Deferred validation work

FundFinancialValidationWork has primary key (transactionId,scopeType,scopeId).
AFTER row triggers insert affected OLD and NEW scopes with ON CONFLICT DO NOTHING.
Fund work validates only that Fund's snapshot, closure and payment/receipt pairs.
Village work checks only that village's ACTIVE fund lifecycle/head obligations.
Activation and extension transition checks remain targeted event checks, preserving
information that cannot be inferred from only the final Fund row.

A deferred constraint trigger atomically deletes/consumes its work row, validates,
and returns. Duplicate deferred callbacks see no work. A failure rolls back the
transaction (including the deletion). Savepoint rollback restores/deletes queued
work as normal data; no nontransactional session flag is used. An early SET
CONSTRAINTS flush consumes existing work; later writes insert new work and must
validate again. Required multi-record operations must keep constraints deferred
until their intermediate states are complete. No global financial scans remain;
per-Fund history and per-village active-house checks are still volume-dependent.

Internal tables revoke PUBLIC access. Acquisition, bootstrap, enqueue and drain
functions use SECURITY DEFINER with fixed pg_catalog,public,pg_temp search paths.
Internal helper execution is revoked from PUBLIC; only the acquisition entry point
needs an explicit EXECUTE grant to the runtime role at deployment. Runtime roles
must have no direct internal-table DML, table ownership, DDL, TRUNCATE, trigger
bypass, or CREATE on public. Migration owner is trusted. Audit actual grants and
default privileges; revoking PUBLIC alone does not remove explicit role grants.
No credentials/roles/grants are provisioned in this offline phase.

## Transaction inventory (existing files; read now, application changes Phase 3)

All paths below are under src/ unless explicitly prefixed scripts/.

| Existing file(s) | Current transaction/lock pattern | Required integration |
|---|---|---|
| lib/authz/village.ts; lib/authz/house.ts | Village FOR SHARE then House FOR NO KEY UPDATE | Acquire scope before both; retain village security guard |
| features/house-management/actions/create-house.action.ts, deactivate-house.action.ts, reactivate-house.action.ts, update-house-number.action.ts | Transaction + village guard; deactivate/renumber explicitly lock House | Scope first, indexed active-assessment guards |
| features/household-management/actions/approve-member.action.ts, reject-member.action.ts, remove-member.action.ts, change-head.action.ts, chief-approve-first-member.action.ts, chief-reject-pending-member.action.ts; features/household-management/lib/remove-member-transaction.ts | Village guard; selected paths explicitly lock House; membership/head writes | Scope before reads/House lock; atomic valid head replacement |
| features/villager-registration/actions/register-villager.action.ts; features/membership-rejoin/actions/submit-rejoin-request.action.ts | Transactions, village guard then House lock | Scope before eligibility reads; retry whole operation |
| features/village-management/actions/create-village.action.ts | Village/Chief creation transaction | Automatic bootstrap; scope for subsequent writes |
| features/village-management/lib/change-village-status.ts | Serializable status compare-and-set + audit | Scope before reads; retain deactivation guards |
| features/village-deactivation/lib/village-deactivation-service.ts, deactivation-transitions.ts, deactivation-worker-store.ts | Serializable transitions; Village locking/status touch; worker request claims FOR UPDATE SKIP LOCKED | Scope first for lifecycle transitions; avoid scope for lease bookkeeping; keep SKIP LOCKED claim transaction short |
| features/fund-management/actions/create-fund.action.ts, update-fund.action.ts, activate-fund.action.ts, close-fund.action.ts | Village guard; activation/closure serializable | Replace legacy target writers in later approved phases; scope before snapshot reads, explicit Fund locks |
| features/cash-payment/actions/record-cash-payment.action.ts, void-payment.action.ts | Serializable transactions + village guard; Payment/Receipt/audit writes | Scope first, submitted Fund/version, transactional authorization and atomic void/receipt |
| features/collector-assignment/actions/assign-collector.action.ts, deactivate-collector-assignment.action.ts | Village guard; transactional assignment/audit | Scope before authority read/write; coordinate payment revocation |
| features/user-settings/actions/change-password.action.ts, update-profile.action.ts; lib/auth/session.ts | Password/session/profile writes; some profile flows take village guard | No financial scope for unrelated columns; preserve authentication/session semantics |
| features/password-recovery/lib/password-recovery-service.ts, recovery-transitions.ts; scripts/reset-admin-password.ts | User password/session changes with audit | No financial scope for password-only changes |
| features/auth/actions/login.action.ts, logout.action.ts; lib/audit/audit.service.ts | Audit producers, some outside financial transactions | Unrelated audit inserts need no scope; financial audit insert remains atomic with writer |
| lib/receipts/receipt-number.ts | Global daily advisory lock, count-based receipt allocation | Retained dependency; acquire late; no earlier-category locks afterwards; benchmark separately |
| lib/db/transaction.ts; lib/db/retry.ts | Bounded serializable retry/adapter conflict recognition | Verify 40001/40P01 recognition and whole-transaction retry for every integrated writer |

## Dates, tests and performance gates

DATE boundaries use Asia/Yangon. Internal pure SQL predicates accept an explicit
instant for deterministic tests; production triggers pass clock_timestamp(). No
session variable can override the production clock. Timestamps store UTC.

Integration tests use rollback fixtures or separately opted-in, uniquely named
disposable databases for real commits/concurrency. Every rejection asserts a named
constraint, SQLSTATE or stable trigger message; no generic any-error assertion.
Positive default-variable-conflict extension exercises the formerly ambiguous path.

Deferred benchmarks: 10 villages x 100 houses; 100 villages x 1,000 houses with 20
closed funds each; 1/8/32 writers, same-village and cross-village. Measure activation
time, payment p50/p95/p99, lock waits, retries/deadlocks, work callback count and
rows examined. Include password/audit background traffic and savepoint/flush cases.
Agree latency budgets on actual hardware. Require no cross-village financial root
waits and validation cost tied to affected scopes. No benchmarks/tests ran here.


Final Phase 2 review additions: the executable read-only privilege gate is
scripts/fund-financial-privilege-assertions.sql. Runtime roles are deployment
inputs, not repository-defined identities; each login and its reachable roles must
pass the gate before release. The restricted-role integration suite separately
opts in to transactional creation of a random disposable NOLOGIN test role.

Tests now cover stale scope acquisition through the entry function at REPEATABLE
READ and SERIALIZABLE; invalid re-enqueue after early flush; restored pre-savepoint
work; OLD/NEW village queues; reversed multi-scope inputs; committed closure before
payment retry; and financial writes in separate villages while one remains open.
Legacy trigger fallback remains a separate test. Boundary tests use an otherwise
eligible post-activation house and a real cross-village Payment/Receipt mismatch.
All of these remain authored test cases, without executable verification.
