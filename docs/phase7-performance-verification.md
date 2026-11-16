# Phase 7.8 — Measure and address performance

Status: **Implemented — Performance Measurement Pending**.
No tests, typecheck, lint, build, database operations or benchmarks were executed
while implementing this task. No measured capacity claim is made.

## Delivered change

The Collector dashboard uses one village/collector/ACCEPTED aggregate for its
lifetime total and both count displays. It no longer enumerates all accepted
payments to build an unused monthly series. getCollectorChartData remains available
unchanged, including its existing calendar attribution. Authorization and lifetime
meaning are unchanged. This removes provably unused work; latency savings are unmeasured.

Reporting, reconciliation, history and audit query designs, dataset limits,
financial definitions and transaction options remain unchanged. No indexes,
migrations, dependencies, production logging or package scripts were added.

## Safe execution boundary

Run only after owner-approved Replit verification begins. This suite requires all:

- VFC_RUN_PHASE7_PERFORMANCE=1 (new explicit performance opt-in)
- VFC_RUN_REPORT_POSTGRES_TESTS=1 (existing sandbox opt-in)
- TEST_DATABASE_ALLOW_REMOTE=1
- NODE_ENV other than production
- Existing NEON_REPORT_API_KEY, NEON_REPORT_PROJECT_ID, NEON_REPORT_PROJECT_NAME,
  NEON_REPORT_PARENT_BRANCH_ID, NEON_REPORT_PARENT_BRANCH_NAME,
  NEON_REPORT_DB_ROLE, NEON_REPORT_DB_PASSWORD, as documented in README.

Without these opt-ins the suite is skipped before branch creation or connection.
startReportPostgresSandbox verifies the project, non-default parent, owned child,
endpoint and actual database/role handshake. All clients come from its validated
openTestDatabase call. No application singleton is opened; the injected Prisma
client targets only that fresh child. Do not provide a production URL. The harness
never reads DATABASE_URL or accepts an existing TEST_DATABASE_URL target.

Before any fixture write, preflight checks every migration-defined scope/enqueue
trigger, Village bootstrap, Fund guard/transition, assessment/payment/receipt/
extension guard, extension-applied, validation-work, audit guard and financial
no-truncate trigger. Table, name, function/schema, event/timing/row bits, zero
arguments, unconditional execution, deferral flags and enabled O/A state must
match. session_replication_role must be origin. Failure stops provisioning; the
harness never repairs or enables protection.

Fixtures use normal INSERT/UPDATE transitions with triggers/constraints enabled.
Each Fund fixture commits before reports execute on separate transactions. All
IDs are unique per run. Do not truncate, delete financial rows, disable triggers,
reset passwords, migrate or use the existing dedicated test database. Cleanup
restores instrumentation, then disposes only the verified owned child branch.
Errors including disposal failures propagate through AggregateError. Follow the
README exact-run-name recovery procedure if disposal or branch creation fails.

The existing sandbox pool max is **3**. The suite deliberately tests request
concurrency 1, 5 and 10 against that pool; queueing is part of the result. Do not
raise pool limits or transaction deadlines merely to obtain a passing benchmark.
One interactive transaction executes its statements serially even with Promise.all.

## Reproducible profiles

Run one profile per fresh branch/process; never run multiple benchmark suites in
parallel. These are synthetic assumptions, not actual production demographics.

| VFC_PERF_PROFILE | Villages | People | Households | History |
| --- | --- | --- | --- | --- |
| primary (default) | 10 | 200 each / 2,000 total | 60 each / 600 total | 24 CLOSED Funds each by default |
| comparison | 10 | 200 each / 2,000 total | 50 each / 500 total | same history |
| concentrated | 10 | 1,100 + 9 × 100 / 2,000 total | 330 + 9 × 30 / 600 total | same history |
| boundary | 1 | boundary row count | boundary row count | no CLOSED Funds |

VFC_PERF_HISTORY is configurable from 1–120 (default 24); historical Funds are in
addition to one ACTIVE and one DRAFT per village. Distribute people across houses
with active heads. One active collector and an inactive former-collector assignment
are persisted. Every tenth paid house has two void/replacement corrections, all
original payments/receipts/audits retained. Payment timestamps tie within a Fund.
Historical Funds are fully paid/CLOSED; the current Fund is partially paid after a
persisted extension. Dates permit normal guarded insertion at execution time;
Payment.createdAt is deliberately earlier for historical filtering.

Boundary runs select VFC_PERF_BOUNDARY_ROWS=9999, 10000 or 10001. An unpaid ACTIVE
Fund exercises assessment/association-list boundaries; a separate DRAFT Fund has
that many valid creation/update audit events. Above-cap reconciliation must become
uncertain and suppress incomplete financial metrics. The approved report reader
still processes its complete assessment set. Boundary cardinalities exceed intended
population and must be reported separately. VFC_PERF_COMBINED=1 with the boundary
profile also creates exactly the requested number of persisted extensions and
payment/receipt records on that Fund: one household has a long correction chain,
with original receipts and matching audits retained. Extensions advance expired
calendar dates normally before the final extension opens the payment window.
Each matching extension/version pair explicitly flushes deferred constraints
(IMMEDIATE, then DEFERRED for subsequent operations); this enforces the guards
while that version is current and never disables constraints or triggers. This
exercises four large association lists together; audit overflow is expected.
Provisioning this deliberately extreme profile may take substantial time and is
excluded from timings. Run it separately with the same 9999/10000/10001 sizes.

## Commands for later Replit use only

Supply Neon secrets through Replit Secrets, never inline or in output. Record the
exact feature revision and cumulative source-tree fingerprint used for the run.
Set VFC_PERF_REFERENCE to nonsecret PostgreSQL/Neon compute size, database region,
Replit region, and relevant process/container resources. Record compute wake state.
Set VFC_PERF_REVISION and VFC_PERF_TREE_SHA256 to the actual reviewed sources.
UNRECORDED metadata is not sufficient for final performance acceptance.

```sh
VFC_RUN_PHASE7_PERFORMANCE=1 VFC_RUN_REPORT_POSTGRES_TESTS=1 \
TEST_DATABASE_ALLOW_REMOTE=1 VFC_PERF_PROFILE=primary \
npx vitest run --no-file-parallelism src/test-support/phase7-performance.integration.test.ts
```

Repeat for comparison, concentrated, history-heavy (e.g. VFC_PERF_HISTORY=120),
and each boundary size. Use the same compute/resource configuration when comparing.
Do not invoke the general integration script: unrelated suites must not be opted in.
Focused authored unit tests can later be run separately:

```sh
npx vitest run src/features/analytics/lib/collector-summary.test.ts src/features/fund-management/lib/fund-page-readers.test.ts src/features/fund-management/components/fund-presentation.test.ts src/test-support/phase7-performance-measurements.test.ts
```

## Measurements and limits

Provisioning and fixture generation are excluded. Scenarios use actual report,
reconciliation, lifecycle, audit, cash and receipt readers. Authentication boundary
substitution supplies synthetic identities; in-transaction session/password/role/
membership/village/assignment checks and all database queries remain real.
Village/platform audit functions lack internal auth guards; their direct query
measurements are **not** route authorization verification. No results certify login
or whole-page authorization.

Before fixtures, record inherited VILLAGE audit cardinality on the owned child.
A baseline over 10,000 records stops the run to bound discovery; inherited data is
never deleted. Each synthetic village gets one creation annotation plus 24
explicit benchmark annotations through the existing createAuditLog service in a
committed Prisma transaction. These are synthetic annotations, not claims of 24
real Village state transitions. All carry the run identity and real fixture
Village/Chief links; the real AuditLog guard runs. Record 250 synthetic village
audit IDs for ten-village profiles, or 25 for boundary. Before timing, page the
bounded platform dataset and require every generated ID to be discoverable.

platform-audit-populated checks the expected total (baseline plus synthetic count)
and requires a full first page of known synthetic IDs. Inherited rows cannot satisfy
this assertion. Future-dated inherited rows obscuring that page fail closed and
require a reviewed baseline setup, not deletion or a relaxed assertion.
platform-audit-empty uses the reserved Yangon calendar day 2099-01-01, outside the
current synthetic fixture dates and expected inherited audit history. The real
shared parser produces gte=2098-12-31T17:30:00.000Z and exclusive
lt=2099-01-01T17:30:00.000Z, keeping both boundaries in ordinary PostgreSQL AD years.
The scenario requires exactly zero logs and zero total; any unexpected inherited
records in that window cause an explicit assertion failure and are never ignored.
The focused parser regression is authored but not executed. Output distinguishes
both scenario names, inheritedVillageAudits and syntheticVillageAudits. No inherited
row contents or personal information are logged.

Each scenario records its first observed request (not a guaranteed cold cache),
five warm-ups, then 100 requests at each concurrency level. Deep cursor anchors
are prepared separately; every measured page reauthorizes and resolves its anchor.
Receipt access is exercised for Chief, collector, payer and former collector, plus
cross-village report denial and non-Chief reconciliation denial. Metrics assertions
run alongside samples. Included status/date filters use linked Payment.createdAt.
A broad date range and an empty same-day range are included; narrower real-date
windows and full multi-page uniqueness need the existing correctness suites.

The test-only pg observer preserves callback/promise interfaces and propagates
errors. Callback wrappers capture their registering request's AsyncLocalStorage
context and restore it when invoked, including when a queued callback is dispatched
from another request's context. Receivers, arguments, returns and thrown errors are
preserved. A queued callback unit regression deliberately dispatches B from A.
Each first request and measured sample must observe SQL and acquisition; transaction
readers must also observe a completed transaction. Output counts incompleteInstrumentation
per scenario, and any incomplete sample fails the gate. One request's positive
maxSql cannot cover another request's missing observation.
It counts actual SQL separately from reader invocations, parameters, returned row
counts, accumulated SQL duration, transaction BEGIN-to-COMMIT/ROLLBACK duration,
JSON result bytes and request duration. Pool acquisition includes connection setup
when needed. JSON bytes are not wire/RSC bytes. Heap before/after and process-wide
peak RSS are observations, not isolated per-request allocations. Timed failures
are counted without printing exception messages or values.

The JSON summary emits p50/p95/p99, throughput, errors, row/parameter/result bounds,
transaction p99 and acquisition p95. Preserve stdout as an artifact securely. The
suite reports all measured scenarios before enforcing thresholds. Preflight or
fixture failure can stop a run earlier and still attempts owned-branch disposal.

Optional VFC_PERF_EXPLAIN=1 executes EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) over
representative captured SELECT shapes **after** latency sampling, on the child.
SQL is parameterized; output contains shape hashes and plans, never credential URLs.
Plans can contain synthetic fixture IDs. Statement parameters are held only in
memory and cleared on disposal. This sample is one parameter set per SQL shape;
it is not a substitute for examining selective/unselective parameter variants.
EXPLAIN really executes SELECTs and is intentionally absent from timed samples.

Proposed gates on the recorded reference environment:

- Warm reader p95 ≤ 1 s for history/lifecycle/audit; report/reconciliation ≤ 2 s.
- Transaction p99 ≤ 3 s; existing timeout stays 5 s, maxWait stays 2 s.
- Pool acquisition p95 ≤ 250 ms; no unexpected request/acquisition timeout.
- Complete page server response p95 ≤ 3 s (manual/browser gate, not this harness).
- Zero unexpected errors, incorrect monetary results, tenant disclosures or lost/
  duplicated history records. Exactly-at-cap stays complete; overflow never clean.
- Boundary queries must avoid parameter-limit errors/timeouts. Any failure is a
  recorded failed gate requiring investigation, not permission to relax safeguards.

## Deferred Replit gates and evidence-backed changes

Run all authored correctness tests and cumulative regressions, typecheck, lint,
build, actual PostgreSQL isolation/read-only/timeout recovery and browser checks.
Measure authenticated dashboard, detail, Fund list, cash form, broad household
search, demographics and their combined SQL/payloads through whole-page requests;
these paths are not simulated by a mocked-render benchmark. Record query counts
and verify no per-row queries. Capture selective Yangon date filters, deep offset
audit pages, Fund-option cardinality and active-head/member relation payloads.

Inspect actual plans with table statistics, scanned/returned rows, buffers, sorting,
planning/execution time and parameter count. Existing indexes may already suffice.
Any optimization needs before/after equivalent results and the same reference
fixtures/configuration. Audit splitting must retain the full authorized union,
deduplicate IDs, preserve global ordering and one global cap/lookahead. Do not
remove association predicates, truncate financial inputs, weaken tenant predicates,
cache across identities, change timeouts, or add speculative indexes. Any index or
migration requires measured evidence plus a separately reviewed proposal covering
write/storage overhead. Task 7.9 is not started.

## Boundary outcomes authored for later execution

Before observation begins, record exact per-Fund assessment, payment, receipt,
extension and audit counts, including the independent DRAFT audit-cap Fund. The
ACTIVE combined fixture must have N assessments, N payments, N receipts, N
extensions and 6N−1 audit records. Assessment-only boundary has N assessments,
zero payments/receipts, one extension and three audits. DRAFT has only N audits.
These counts are asserted outside latency samples and included in the JSON artifact.

At N=9,999 and 10,000, combined assessment/payment/receipt/lifecycle outcomes must
all be PASS. Audit alone is UNVERIFIED, with INPUT_INCOMPLETE dependency audit.
Financial metrics remain available. At N=10,001 all combined categories must be
UNVERIFIED and metrics null. Exact dependency sets follow the unchanged evaluator:

- assessments: assessments
- payments: assessments, payments
- receipts: payments, receipts
- lifecycle: assessments, payments, lifecycle
- audit: assessments, payments, receipts, lifecycle, audit

For assessment-only overflow, receipt checks remain independently PASS; payments
and lifecycle depend on missing assessments. Audit is UNVERIFIED because its
association coverage depends on complete input IDs, even if fetched audits are
below cap. DRAFT lifecycle remains NOT_APPLICABLE and only overflowing audit input
marks audit UNVERIFIED. Every deliberately valid fixture must have no DISCREPANCY
findings, exact category outcomes and exact INPUT_INCOMPLETE dependencies; clean=false
alone never suffices. Other explanatory UNVERIFIED findings may accompany these.

All new safety, attribution, boundary and dashboard-prop regression tests are
AUTHORED ONLY. No execution result or Astra approval is implied. Full trigger-body
identity is not hashed: preflight validates trigger wiring against the migration;
reviewed, migrated parent schema remains an infrastructure prerequisite.
