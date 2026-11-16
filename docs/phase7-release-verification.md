# Phase 7.9 release verification preparation

Status: **Implemented — Release Verification Pending**. Every gate below is
currently NOT VERIFIED. Task 7.8 remains **Implemented — Performance Measurement
Pending**. No command in this document was executed during preparation.

## Approval and revision boundary

Astra static review → owner acceptance of preparation → separately authorized
GitHub push → exact pushed revision in Replit → verification/debugging → Qwen
review. This runner neither publishes nor deploys. A code correction invalidates
results for the old revision; review, publish and rerun affected gates.

Before execution, record these read-only commands and require the authorized SHA,
branch and a clean tree (including untracked files). Put artifacts outside source:

```sh
git rev-parse HEAD
git branch --show-current
git status --porcelain=v1
git diff --check
node --version
npm --version
```

Then, only during separately authorized verification:

```sh
npm ci
npm ls --depth=0
npx prisma validate
npm run db:generate
npm run typecheck -- --incremental false
npm run lint
npm run build
```

Use local installed tooling; tsx already exists in package.json and lockfile.
Do not download a replacement tool. npm ci includes the existing generate
postinstall. Compare package-lock.json before/after; version/integrity changes
require review. Configure Prisma with an explicitly non-production, non-routable
URL for validation/generation. If build performs data reads, stop until a verified
child-only application process is arranged; do not provide an ambient real URL.

## Opt-ins and owned-child isolation

All runner modes require VFC_RUN_PHASE7_RELEASE=1. Database modes additionally
require VFC_RUN_REPORT_POSTGRES_TESTS=1, TEST_DATABASE_ALLOW_REMOTE=1, a
non-production process, and the existing secrets/configuration:
NEON_REPORT_API_KEY, NEON_REPORT_PROJECT_ID, NEON_REPORT_PROJECT_NAME,
NEON_REPORT_PARENT_BRANCH_ID, NEON_REPORT_PARENT_BRANCH_NAME,
NEON_REPORT_DB_ROLE, NEON_REPORT_DB_PASSWORD.

Provide secrets through the environment, never command text, artifacts or logs.
Do not supply a production DATABASE_URL. No incoming TEST_DATABASE_URL selects a
release target. The existing sandbox verifies project, non-default parent, owned
child, direct endpoint, TLS and actual database/role/application identity.

The release adapter uses this same lifecycle, not another Neon API client.
Fresh mode uses the child's database API to create vfc_test_<32 lowercase hex>
with the configured owner. It requires matching response identity, then an actual
server handshake before the callback. Only that child endpoint is used.
Permission/API incompatibility fails closed. No DROP DATABASE, reset, truncation,
constraint bypass or financial-history cleanup occurs. Child deletion is the only
persistent fixture cleanup; each owned branch is independently attested.

The parent must already contain the reviewed migrated schema. The runner never
connects to it or applies parent migrations. Stale parent setup is an infrastructure
blocker requiring separate provisioning approval. Legacy callback helpers now
create their own verified child per fixture. The orchestration child's URL enables
legacy opt-in selection; those helpers do not reuse that URL as authority. This
costs additional branch provisioning, included in the owning fixture lifecycle.

SQL connections close before disposal. All cleanup errors fail the operation.
Lost branch-creation responses: use the logged unique run name, project, parent,
and requested timestamp; inspect actual child metadata and endpoint, verify
non-default/non-primary/unprotected ownership, then manually remove only the
exact matched run branch. Never guess an ID or delete a parent. Record orphan IDs
and final deletion confirmation. A timed-out close is not a completed close.

## Runner and count contract

Prepare a reviewed JSON expected inventory outside the checkout:

```json
{"sha":"<exact pushed SHA>","mode":"reporting","files":["<ordered exact manifest paths>"],"cases":[{"file":"<manifest path>","name":"<Vitest fullName>","ordinal":0}]}
```

List every expanded case, including duplicate names with their per-file assertion
ordinal. All manifest files must be represented. Bind it using
VFC_RELEASE_EXPECTED_COUNTS (file path; retained variable name),
VFC_RELEASE_INVENTORY_SHA256 (independently reviewed SHA-256 of exact JSON bytes),
and VFC_RELEASE_REVISION (authorized pushed SHA). It is never auto-updated from a
passing or failing run. Same counts with different names/files fail the gate.
Set VFC_RELEASE_EVIDENCE_DIR to an explicit directory outside the checkout.
Each run atomically publishes a BLOCKED release-<uuid>-checkpoint.json before
private-report cleanup, then a final release-<uuid>.json (0600). Neither replaces
an existing artifact. A checkpoint alone is never PASS evidence. Keep reviewed inventory and evidence under access controls.

```sh
VFC_RUN_PHASE7_RELEASE=1 npx tsx scripts/phase7-release.ts units
# Supply the database opt-ins and Neon environment above for database modes.
npx tsx scripts/phase7-release.ts integrity
npx tsx scripts/phase7-release.ts privileges
npx tsx scripts/phase7-release.ts operations
npx tsx scripts/phase7-release.ts concurrency
npx tsx scripts/phase7-release.ts reporting
npx tsx scripts/phase7-release.ts browser
npx tsx scripts/phase7-release.ts historical
npx tsx scripts/phase7-release.ts recovery
```

Integrity, operations and concurrency independently require
VFC_ALLOW_MIGRATION_TESTS=1. Privileges independently requires
VFC_ALLOW_ROLE_TESTS=1. Reporting does not inherit either flag. A role suite must
not be silently skipped if Neon lacks CREATE ROLE/membership/grant permissions.

The runner invokes local Vitest with --no-file-parallelism and explicit paths.
Units enumerates only non-integration *.test.ts beneath src; no database/Neon
credentials or database opt-ins are inherited. Database subprocesses receive only
the verified TEST_DATABASE_URL and mode-specific credentials/flags. Database modes use a non-routable DATABASE_URL; units omit the key entirely. No broad integration wildcard is used.

Counts must exactly match reviewed expectations, with zero failures and zero
skips. A zero exit alone is insufficient. Failed collection, timeout, skipped
case, missing JSON or count mismatch blocks the gate. Pending manual modes emit
NOT VERIFIED and exit 2; they do not provision branches or certify completion.

Private raw Vitest JSON is temporary and deleted; sanitized final evidence is
retained outside the checkout on success or failure. It includes UTC timestamps,
run ID, SHA/branch/tree state, command (private output path replaced with <PRIVATE_REPORT>), opt-in names, manifest/inventory
hashes, expected and actual per-case identities/status/reasons, exit/signal,
collection status, cleanup and ownership recovery breadcrumbs. Unknown names become UNREVIEWED_CASE and block incomplete collection; raw
assertion/database diagnostics and arbitrary pendingReason text are never copied.
Reporter statuses are passed, failed, pending, skipped and todo (from the installed
Vitest JSON StatusMap). Other values become UNKNOWN_STATUS/COLLECTION_ERROR,
mark collection INCOMPLETE and block. Reasons are null for passed,
ASSERTION_OR_EXECUTION_FAILED for failed, UNKNOWN_SKIP_REASON for supported
non-passing states, and COLLECTION_ERROR for invalid identity/status. A boolean
records whether a pendingReason field existed, without interpreting its content.
All skips block. Only normalized reviewed inventory fields are retained. Nonzero exit, malformed/missing output, inventory mismatch
and cleanup errors persist BLOCKED evidence. Test and cleanup failures coexist.
Manual modes still return NOT VERIFIED/exit 2; use the reviewed evidence ledger.

## Awaited lifecycle ownership and budgets

The release runner uses vitest.release.config.ts, with envDir=false. Unit child
processes omit DATABASE_URL and all database/Neon aliases and opt-ins. Vite does
not load application .env files. Unit tests must not explicitly load dotenv or
import application connection singletons without a mocked boundary.

New release-only setup hooks import only phase7-release-registry.ts, which has
no database/Neon/adapter imports. A Symbol.for global registry survives module
cache resets within a worker. It queues work only after registering its promise.
The adapter and report suite use that same registry. Hooks await pending operations before
and after each test and at suite teardown, with hook timeout 0 and default test timeout 0. Existing explicit case deadlines
remain; the drain hook owns their unfinished adapter work. The actual report-suite provisioning beforeAll, fixture setup and teardown
use timeout 0 in release mode. The available Vitest runner source explicitly returns
the original function when timeout <= 0. Report teardown awaits its captured setup
promise, then cleans up the resource assigned by that setup, even on late completion.
Setup and cleanup failures are retained together. Non-release hook deadlines remain. Per-test setup,
body, rollback, connection close and branch disposal remain one tracked promise.
An individual test deadline may fail its assertion phase, but its owning teardown
hook remains active until that promise settles; subsequent tests cannot start
using still-running fixture work. Original body and cleanup failures are retained.
These hooks are necessary infrastructure and do not change production deadlines.

Actual existing budgets: each Neon API fetch has a 10s AbortSignal timeout;
readiness polls have a 60s deadline checked after two API requests (so up to 20s
additional request budget); initial pool acquisition/connect budget is 10s;
deletion confirmation has a 20s deadline checked between API requests. Several
sequential calls contribute to setup. There is no honest universal hard wall-clock
maximum: Prisma/Pool/Client closes cannot be cancelled through their current APIs.
Release closes therefore await settlement instead of racing/abandoning a promise.
A close completed after 10s reports a late-close failure. The complete adapter
lifecycle has a 300s accounting budget, checked after all cleanup settles; overruns
fail. This is a detection budget, not a claim of cancellation or a finite upper
bound. A permanently stuck close keeps the owner active and needs operator
investigation and exact-run recovery; never kill it and claim successful cleanup.
Default non-release performance/report behavior remains unchanged. Provisioning
IS included in legacy per-test lifecycle elapsed time, not reader timing samples.

## Exact automated suite manifest

All paths below are relative to the repository. See scripts/phase7-release.ts for
the authoritative allowlist; additions require review.

| Mode | Files |
| --- | --- |
| integrity | src/features/fund-management/lib/fund-migration.integration.test.ts; fund-schema.integration.test.ts; fund-immutability.integration.test.ts in the same directory |
| privileges | src/features/fund-management/lib/fund-runtime-security.integration.test.ts |
| operations | src/features/fund-management/actions/fund-activation.integration.test.ts; fund-completion.integration.test.ts in that directory; src/features/cash-payment/actions/payment-authorization.integration.test.ts; src/features/collector-assignment/actions/collector-authorization.integration.test.ts; src/features/household-management/lib/household-write.integration.test.ts; src/features/village-management/lib/village-financial-lifecycle.integration.test.ts; src/lib/authz/transaction-authority.integration.test.ts; village-write-guard.integration.test.ts in that directory |
| concurrency | src/features/fund-management/lib/fund-concurrency.integration.test.ts; src/features/fund-management/actions/fund-completion-concurrency.integration.test.ts; src/features/cash-payment/actions/receipt-allocation.integration.test.ts; src/lib/db/village-scope.integration.test.ts |
| reporting | src/features/fund-management/lib/fund-report-queries.integration.test.ts; src/test-support/phase7-release.integration.test.ts |

## Mandatory gates and stop conditions

| Gate | Expected evidence / pass requirement | Stop condition |
| --- | --- | --- |
| Revision/dependencies/static | Exact authorized pushed SHA, clean tree, versions/lock hash, successful commands above | SHA drift, changed lock, install/generation/type/lint/build error |
| Financial units | Exact MMK caps/rounding, 100001/100-house overpayment example, target versus obligations, partial rejection, VOIDED/replacement, DRAFT nulls, reconciliation outcomes | Any monetary/state/assertion failure |
| Database integrity | Real migration baseline/financial SQL success, refusal of unexpected history, rollback of injected DDL failure, trigger/constraint/immutability assertions | Drift, missing/disabled protections, nontransactional partial state |
| Operations/auth | Real Chief/Collector actions, platform denials, personal payer access, tenant isolation, revoked assignment/membership/session/password, audit failure rollback | Unauthorized data/write or partial records |
| Restricted role | Existing privilege assertion body and protected operations; each actual application/worker role separately checked in rehearsal | Owner/superuser/unsafe grants; missing permissions to prove gate |
| Concurrency | Same-house initial/replacement competition, payment/closure, void/closure, extension/closure, revocation, real two-village allocator wait, unique receipts, bounded attempts and final states | Arbitrary error accepted as outcome, missing observed contention, partial state/leak |
| Production deadlines | Added allocator and completion variants retain original production options, successful final states and connection recovery | Timeout/retry exhaustion; do not increase settings |
| Reporting/history | Real full traversal and tied IDs, payment-date filters, personal options, snapshot before void, replacement identities, persisted lifecycle/audit facts | Lost/duplicate/foreign rows, fabricated obligation, mixed snapshot |
| Reconciliation | Valid fixture clean; incomplete actor evidence UNVERIFIED with independent metrics; unit invalid/capped inputs never false clean | Incomplete evidence accepted as clean or invalid rows dropped |
| Browser | Completed genuine-session checklist with fixture IDs/expected values | Unchecked interactions, disclosure, hydration or confirmation errors |
| Historical | Real legally expired fixtures and observed outcomes | No valid historical fixture or attempt to manipulate time/history |
| Performance | Approved Task 7.8 profiles, complete instrumentation and thresholds | Incorrect metrics, missing observations, unexpected errors, exceeded targets |
| Deployment/recovery | Checksums, preflight, role split, restored backup verified, writer exclusion, recovery evidence | Unexplained history/drift, restore failure, old/new writers concurrent |

Run fail-fast in table order. No measurements establish acceptable performance
until correctness gates pass. Existing deterministic 20-second concurrency cases
remain useful; only their separately labelled production-option variants address
production transaction deadlines. Their outer test deadlines do not change DB
transaction deadlines. Record attempts, SQLSTATE/Prisma codes, pg_locks/
pg_blocking_pids evidence, final rows/audits and recovery. Some legacy suites own
external pools: observe actual adapter close ownership/process exit; leaks block
release and need evidence-based correction, not forced database deletion.

## Reporting coverage boundaries

The release correctness fixture has two villages, 54 frozen houses each, three fully
paid CLOSED Funds (normal, exact boundary and other-payers-only), one 26-paid ACTIVE Fund with persisted extension, and a DRAFT.
Target=54001; expected=54054; surplus=53; ACTIVE accepted=26026;
outstanding=28028; target remaining=27975. Payments tie at a committed timestamp;
receipts are issued on a different day. A later house is unassessed. Real void and
replacement actions preserve original identities. Snapshot barriers are after a
real actor read in Repeatable Read and before a separate action commits.

The database suite compares the report source consumed by dashboard/detail;
actual page wiring is covered by existing page-reader tests and the browser gate.
It does not claim to render live authenticated Next pages. Missing audit actors
are constraint-permitted uncertainty; invalid financial states remain pure tests
or protected rejection tests. The eleventh report test now proves unpaid closure
rejection/rollback, not reader processing of committed corruption. Existing unit
coverage retains invalid-CLOSED reader rejection.

## Manual browser, historical and recovery gates

Browser: follow phase7-release-browser-checklist.md. Configure a dedicated app
process only from a live sandbox.withConnection callback; never use ambient URL.
The script intentionally does not launch an application or claim browser completion.
An operator must keep the child alive, inject its verified URL into only that app's
DATABASE_URL, create login-capable synthetic identities through approved setup,
and stop app/workers/connections before disposing. The correctness fixture hashes
are intentionally not usable passwords. This is a controlled manual procedure,
not an implemented automated app launcher.

Historical: use approved synthetic history already inherited by a new child, or
create/pay a legal Fund before its Yangon end date and allow real time to pass.
Record before/after server instants and the canonical SQL expiry result. Verify
expired ACTIVE recording denial; paid-and-expired closure; expired ACTIVE void;
original receipt identity/status; CLOSED refusal. Never shorten ACTIVE terms,
backdate protected writes, change clocks, rewrite history or disable guards. No
valid fixture means NOT VERIFIED, not PASS or a manufactured historical test.

Recovery: use a verified child source and sandbox.createEmptyDatabase() for the
empty destination on that same owned child. Securely supply pg_dump/pg_restore
connections without command-line passwords; verify source and destination names,
child endpoint and TLS. Record tool/server versions. Do not use --clean,
--disable-triggers, reset, truncate or SQL history deletion. Restore into empty
destination, respecting ownership/privilege requirements; failure is a blocker.
Compare schema, unrelated data, row counts/IDs, assessment/payment/receipt links,
audit relationships, allocator sequences and invariants. Restore role/grant policy
with separately reviewed provisioning and execute
scripts/fund-financial-privilege-assertions.sql for every actual runtime login.
A successful data restore alone does not prove secure deployment. No backup result
is supplied. Retain encrypted backup securely and document retention/deletion.

For deployment rehearsal distinguish an old empty baseline from a database that
already applied the financial migration. Check _prisma_migrations checksums,
completion/rollback fields and actual catalogs against exact committed SQL.
Use scripts/fund-financial-preflight.sql only for its documented baseline. Review
pending destructive legacy migrations. Existing financial history requires a
separate policy; do not delete or infer a backfill. Stop all old writers/workers,
apply reviewed migrations with a separate migration role, assert least privilege
for runtime roles, start only compatible new writers. Before new writes schema/app
recovery needs explicit approval; after new writes prefer reviewed forward repair.
Never blindly roll back to incompatible writers. Rehearse injected migration
failure using the existing test's in-memory SQL only, never edit migration files.

## Performance gate

Reuse docs/phase7-performance-verification.md and its unchanged harness. Primary:
10 villages/2000 people/600 houses/24 historical Funds; comparison 500 houses;
concentrated; history-heavy (120); boundary 9999/10000/10001 including combined.
One profile per fresh branch/process; concurrency 1/5/10. Same reference compute,
region and pool. Reader p95 <=1s history/lifecycle/audit, <=2s report/reconciliation;
transaction p99 <=3s; acquisition p95 <=250ms; page p95 <=3s. These are targets.
Keep actual SQL/parameter counts, throughput, errors, memory and completeness.
Lock waits/retry evidence comes from concurrency observations, not latency guesses.
EXPLAIN runs separately from normal latency interpretation. Whole-page timings
need authenticated browser requests and cannot be inferred from reader samples.
No speculative index, cap, retry or timeout change is permitted.

## Release decisions

PASS/READY: all mandatory gates pass on the exact pushed revision, cleanup succeeds,
and Qwen reviews the evidence. BLOCKED: a failed gate, unsafe prerequisite,
revision drift, unverified ownership, cleanup failure or missing infrastructure.
NOT VERIFIED: authored/reviewed/unrun/skipped/manual-pending work. EXCEPTION
APPROVED: explicit owner, scope, rationale, compensating evidence and expiry;
never silently convert it to PASS or waive money/security/database targeting.

Use phase7-release-evidence-template.md. Skips and static review are not runtime
success. Expected-count review, Neon CREATE DATABASE/role permissions, historical
fixtures, restore tools and secure manual app provisioning remain execution
prerequisites. All commands and authored tests are unexecuted.

## Exact date and authorization regressions

Boundary fixture day 2026-01-02 is parsed by parseFinancialDateRange. Four Payment
createdAt values are inserted at gte-1ms, gte, lt-1ms and lt. Both history readers
must return exactly the middle two IDs. Their receipts are issued outside the
interval, while excluded payments have receipts issued inside it. Date filtering
uses Payment.createdAt and [gte,lt), never Receipt.createdAt. These timestamps are
set at insertion and never rewritten. The boundary Fund remains legally guarded.
The same-village other-payers Fund has no receipts paid by the personal or former
Collector identities. Neither may see its selector option or request its history;
UNAVAILABLE is asserted. Frozen household h2 is located by exact Payment ID through
keyset pages; its display is Frozen 2, differs from renamed live House and retains
its original Receipt link. All these regressions remain AUTHORED ONLY.


## Atomic publication and private recovery after the third correction

The Linux/Node preparation implementation uses fs.open("wx", 0600), file sync,
same-directory hard-link publication (atomic no-replace), exact-content readback,
temporary-name removal and directory sync. Unsupported hard links or directory
sync are blockers; there is no overwriting rename fallback. Actual Replit filesystem
support has NOT been exercised. Temporary-file failure removes the incomplete
name. A failure after linking attempts to remove only this run's newly linked
artifact, never an existing colliding artifact. Failed rollback/cleanup is explicit;
an artifact alone cannot override a BLOCKED run or missing successful final output.
No atomic filesystem operation guarantees recovery from every host/storage failure.

A sanitized BLOCKED checkpoint is flushed before removing raw reporter output.
Raw deletion failure produces PRIVATE_REPORT_CLEANUP_FAILED and a BLOCKED final
artifact with rawReport=RETAINED_PRIVATE. The final artifact follows deletion and
records rawReport=REMOVED on success. Final publication failure leaves the durable
checkpoint as non-passing evidence. Console publication failures contain only known
run ID, SHA, mode and controlled codes, never driver errors or a private raw path.
No PASS is announced until final publication and its flush/readback complete.

If checkpoint publication fails, raw output remains beneath a mode-0700 directory
outside the checkout, named <runId>-private-<random suffix> in the operating-system
temporary directory. The private path is not persisted in public command evidence.
An authorized operator must inspect that exact run ID under the same OS account,
verify ownership/permissions, and inspect raw data only in private tooling. Do not
upload it, rename it as official evidence or guess another run's directory. Record
controlled failure codes in the ledger; rerun after fixing storage support. Remove
only that confirmed run's private directory after investigation and retention review.
Sanitized .tmp files, if removal failed, are never final evidence; verify full JSON
and exact run/SHA/inventory privately, retain the BLOCKED result and rerun. A process
kill before final publication is an incomplete gate, even if a checkpoint exists.

Third-pass regression tests are AUTHORED ONLY: late setup beyond 300000 ms with
fake time, teardown waiting and combined failures, shared registry/import boundaries
and mocked dependencies, malformed status/identity and withheld personal/SQL/secret
diagnostics, atomic write/flush/link/readback/directory-flush failures and collisions,
signal/inventory failures, private-report deletion failure and publication recovery.


## Fourth correction: canonical private report storage

Before any Neon provisioning or test subprocess launch, createPrivateReportDirectory
resolves the checkout and configured OS temporary parent with realpath. It uses
path.relative with segment boundaries: the checkout itself and descendants are
refused, including symlinks resolving into it; a sibling such as vfc_1-main-private
is not a descendant. Missing, inaccessible or non-directory parents fail closed.
There is no alternate-location fallback. Failure records RAW_STORAGE_UNSAFE with
known run ID/SHA only, without the rejected path or filesystem diagnostic.

The helper creates a unique mkdtemp directory under that resolved external parent,
checks that it is an actual directory owned by the current UID, applies mode 0700,
then rechecks canonical containment, parent, run-name prefix, UID, permissions and
inode/device identity. An invalid new directory is removed only through rmdir,
which cannot recursively erase substituted contents. A removal failure is retained
as a controlled PRIVATE_DIRECTORY_CLEANUP_FAILED error; execution remains blocked.
The runner supplies the canonical validated path only to its private subprocess
argument. Public evidence retains the <PRIVATE_REPORT> placeholder.

Raw reporter output may survive publication failure only in this validated external
private directory. Existing checkpoint/final publication, flushing, no-replace
links, content checks and recovery rules above remain in force. OS temporary-parent
configuration and directory ownership must remain trusted throughout the run;
these path checks are not a filesystem sandbox against a hostile same-UID process.
Actual filesystem behavior remains pending Replit verification.

Additional tests are AUTHORED, NOT EXECUTED: direct/nested/symlinked checkout
parents, nonexistent parents, sibling-prefix containment, mode/UID/canonical
verification, unique directories, invalid post-creation permissions, pre-execution
refusal with no provisioning/spawn, external private raw retention without path
exposure, pending registry ownership across vi.resetModules and re-import, exclusive
temporary-file open failure, and successful readback returning mismatched content.
The publication regressions retain unrelated prior evidence and require BLOCKED
run/SHA output without PASS on failure. No fourth-pass verification was executed.
