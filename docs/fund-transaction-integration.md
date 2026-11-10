# Task 2 Phase 3A — transaction infrastructure contract

Specification v1.0; based on the approved Phase 2 schema and locking protocol.
This increment supplies infrastructure only. Existing application writers have
not yet adopted it. No database, tests, Prisma validation, typecheck, lint or build
was executed during implementation; the authored tests require later verification.
Phase 1/2 files, schema, migrations and the receipt allocator are preserved.

## Transaction entry

`acquireVillageScopes(tx, villageIds)` takes an interactive transaction client.
It validates IDs, deduplicates and sorts without modifying the input, and passes
the complete array to `public.vfc_acquire_villages(text[])` in ONE parameterized
statement. Empty input is rejected. IDs are preserved exactly, not trimmed or
normalized. Every own array position is checked before SQL; holes, undefined,
null, non-strings, blank strings and NUL-containing strings are rejected. No new
ID format is imposed on the schema's text identifiers. The database entry point
rejects nonexistent Village scopes. The function also sorts using database
ordering; it locks
each existing scope row with NOWAIT and increments its revision atomically.
No helper creates or repairs missing rows.

Prisma's `TransactionClient` type alone structurally accepts a root PrismaClient.
`FinancialTransactionClient` additionally excludes `$transaction`, `$connect`
and `$disconnect`; runtime checks reject clients exposing those methods. This is
an accidental-misuse guard, not an authorization or hostile-code boundary. No
helper imports the global client, opens a transaction or chooses isolation.

Supply ALL scopes before eligibility/authority decisions or entity row locks.
Preliminary reads may discover candidate tenant IDs only. Re-read authoritative
records under scope; if another scope is needed, abort and restart with the full
set rather than acquiring it late. Normal authorization and tenant checks remain
mandatory. Scope acquisition does not grant access.

## Lock order

1. All Village scopes, sorted/deduplicated in a single acquisition call.
2. Village rows (`guardVillageWrite` or the applicable lifecycle transition lock).
3. All affected Fund rows, sorted by ID.
4. All affected House rows, sorted by ID.
5. User rows, then CollectorAssignment rows, sorted within each category.
6. Payment rows.
7. Existing global daily receipt allocator, only when allocating a receipt.
8. Receipt rows.
9. Append audit records.

Lifecycle request row locks follow Village rows and precede later entity locks.
Worker lease claiming stays in its own short transaction. New Village creation
inserts the parent first, allows the database bootstrap trigger to create its
scope row, then acquires that scope before subsequent membership writes.

`lockFunds(tx, targets)` and `lockHouses(tx, targets)` accept `{id,villageId}`
targets across all already-acquired scopes. Each list is copied, deduplicated and
globally sorted by entity ID before sequential parameterized queries. Conflicting
Village IDs for one entity are rejected before SQL. Fund uses FOR UPDATE; House
retains FOR NO KEY UPDATE, allowing FK/key-share readers. Every query includes
the entity AND Village ID. An empty entity list is a no-op; a missing or wrong-
Village target throws `VFC_LOCK_TARGET_NOT_FOUND`. Let it abort the transaction;
do not continue after a partially acquired list.

Acquire each category in a single complete helper call. These stateless helpers
cannot prove that scopes were previously acquired, enforce order across separate
calls, or authenticate the actor. Caller integration and tests must establish
those properties. Never return to an earlier category. Existing `lockHouse()`
and `guardVillageWrite()` are unchanged here; their callers move to scope-first
entry in later approved increments.

The database trigger fallback converts scope NOWAIT contention into
`40001 / VFC_SCOPE_BUSY_RETRY_TRANSACTION`. Missing scope is
`P0001 / VFC_SCOPE_MISSING`, which fails closed. Repeatable Read and Serializable
stale snapshots can produce native 40001 through the revision update. Do not
replace the entry function with direct lock-table DML.

## Retry boundary and classification

Keep `withSerializableRetry(operation, retries = 3)` API compatibility. The
operation returns the OUTER `$transaction` promise, so deferred/commit errors are
included. Each retry starts a fresh transaction and repeats authorization,
reads and writes. Never retry an individual statement in an aborted transaction.
The helper does not itself force Serializable isolation.

The retries argument remains the number of retries after the first attempt, but
is capped at three (four TOTAL attempts). Zero disables retries. Negative,
fractional and nonfinite arguments are rejected before executing the operation.
Delay after each abort is `min(250, 50 * 2^attempt + random() * 50)` milliseconds,
with attempt starting at zero. Backoff occurs after the transaction has rejected,
not while intentionally retaining its locks. Exhaustion propagates the last
error unchanged.

`inspectDatabaseError` inspects bounded, cycle-safe known envelopes:
`cause`, `originalError`, `meta.driverAdapterError`, and P2010 `meta`.
It reads structured `code`, `sqlState`, `sqlstate`, `originalCode` and `constraint`
fields. It never parses messages, SQL or arbitrary input metadata. P0001 is a
PostgreSQL SQLSTATE, whereas Prisma P1xxx/P2xxx codes are classified separately.

Retry evidence is raw 40001/40P01, Prisma P2034, or the existing known
DriverAdapterError / meta.driverAdapterError cause with
`kind=TransactionWriteConflict`. Explicit competing business, unique, FK, check,
connection or other codes override generic conflict evidence and prevent replay.
Unrecognized codes or traversal beyond the inspection bound also fail closed.
Unknown errors without confirmed abort evidence propagate unchanged. The parser
returns diagnostics, not user-facing messages or an authorization decision.

Do not retry P0001, 23505/P2002, financial business failures, connection loss or
an uncertain commit outcome. The NOWAIT function's converted 40001 is retryable;
an unrelated raw 55P03 is not automatically retried. Additional adapter shapes
must be reviewed and covered by tests before recognition is broadened.

## Caller pattern (for later increments)

```ts
const result = await withSerializableRetry(() =>
  prisma.$transaction(async (tx) => {
    await acquireVillageScopes(tx, villageIds);
    // Village guard/locks; current authority and tenant rechecks.
    // Ordered Fund/House/User/Payment writes, Receipt and mandatory audit.
    return domainResult;
  }, { isolationLevel: "Serializable" }),
);
// Only after the OUTER transaction resolves:
// redirect/revalidate/notify using result.
```

There are no redirects, cache revalidation, notifications or other external
effects inside the new infrastructure callbacks. Existing application callbacks
are not modified or certified here. Callback purity is a caller obligation;
the retry helper cannot undo an external effect. Unknown connection outcomes
need explicit reconciliation, not automatic payment resubmission.

## Later integration and verification

The complete writer inventory remains in `fund-financial-schema-design.md`.
Phase 3B adds transactional authorization/audit contracts; 3C integrates House,
member and head writers; 3D Village lifecycle/deactivation; 3E assignments;
3F financial transaction entry. Phases 4–7 complete the new financial flows and
reporting. Keep unrelated User/profile/password/session and AuditLog writes out
of financial serialization. The daily receipt allocator remains unchanged and
its global contention/date/count behavior remains a release dependency.

Unit tests cover code classification, nested/cyclic/deep errors, retry caps,
backoff, commit-promise rejection, client misuse, ordering and tenant predicates.
`village-scope.integration.test.ts` exercises the actual Prisma adapter, two
independent connections, NOWAIT contention, independent Villages, revision
deduplication, stale RR/Serializable transactions, real Fund/House lock modes,
missing scope and deferred commit-trigger failures for both SQLSTATEs.
Commit tests inject aborts only in a disposable test table/function; they verify
first-attempt writes roll back before the second transaction succeeds.

The integration suite is skipped unless TEST_DATABASE_URL and
VFC_ALLOW_MIGRATION_TESTS=1 are explicitly set. It reuses the validated disposable
database harness, applies migrations only within that disposable database and
drops it afterward. Never point it at production. It is authored for later Qwen
verification and has not been executed here. Production runtime EXECUTE grants,
adapter error shapes, schema validity and actual concurrency behavior remain
unverified release gates; see the Phase 2 runbook and privilege assertions.

## Focused correction review: dependency evidence and remaining gates

The existing package-lock.json pins @prisma/client, @prisma/adapter-pg and
@prisma/driver-adapter-utils to 7.10.1, and pg to 8.23.1. The lockfile records
resolved tarballs and integrity hashes but contains neither runtime error
envelopes nor the adapter's pool-disposal implementation. In this checkout the
adapter-pg and driver-adapter-utils directories contain no JS/TS source files,
and @prisma/client/runtime is absent. No dependency restoration, package fetch,
npm diagnostics or database execution was performed for this investigation.

There is no concrete local evidence that these pinned versions emit P2010
meta.code="N/A" alongside a nested confirmed 40001. The existing classifier is
therefore unchanged: placeholder codes currently fail closed, even when nested
retry evidence exists. This is a known compatibility question, not an established
production envelope or a reason to permit speculative retries.

At the later Qwen/PostgreSQL verification stage:

1. Inspect the exact restored 7.10.1 client and adapter source/types. Capture
   sanitized structured error fields for actual raw-query and commit-time
   serialization/deadlock aborts, including code, meta.code, adapter cause.kind
   and cause.originalCode. Do not capture SQL arguments, credentials or personal
   data. Establish whether N/A or another placeholder is emitted, at which layer,
   and whether confirmed underlying abort information remains available. If so,
   add evidence-based regression fixtures and separately review selective
   placeholder handling while retaining permanent/ambiguous-error exclusions.
2. Establish whether PrismaPg owns a supplied external pg.Pool, whether
   prisma.$disconnect() closes it, and whether a disposal option is supported
   and enabled by default in 7.10.1. The current integration fixture explicitly
   supplies a Pool but calls only prisma.$disconnect(). Do not assume that this
   releases external resources. Once the contract is established, implement any
   necessary ownership/cleanup correction and verify both success and failure
   cleanup paths. All pool sessions must be closed before the disposable harness
   attempts DROP DATABASE; verify the test process exits cleanly without leaked
   pools. Pool ownership remains unresolved here; no speculative cleanup calls
   or configuration changes were added.

Correction tests are authored, not executed: invalid scope lists assert TypeError
and zero SQL calls; valid lists retain sorting/deduplication. Error tests now
include a positive cyclic 40001 chain. The external-effect test forces the first
attempt to abort and the retry to succeed, then asserts one post-commit effect.
