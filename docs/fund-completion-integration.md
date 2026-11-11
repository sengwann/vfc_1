# Phase 6 — Fund extension and closure

Implemented offline against specification v1.0 plus the owner's explicit early
closure decision. No runtime result is claimed. These increments cannot deploy
independently of the other financial writers and the Phase 2 migration.

## Business rules

Extension requires ACTIVE, Yangon-expired end date, an unpaid frozen assessment,
current submitted Fund ID/version and a currently authorized village Chief.
The new date must strictly exceed the previous date. There is no additional
minimum relative to today, extension count limit or duration limit. Calendar
labels are encoded as UTC midnight for Prisma DATE; this encoding does not
convert the business label into the prior Yangon calendar day.

Closure requires ACTIVE and an ACCEPTED payment for every frozen assessment.
It is allowed before, on and after the end date. Money totals and target attainment
are never completion criteria. VOIDED alone is unpaid; an ACCEPTED replacement
satisfies coverage. Expiry never automatically closes a fund. New houses remain
outside the existing snapshot. CLOSED financial history remains immutable.

## Transaction protocol

The real server actions obtain routing context from requireChief, validate inputs
using submittedFund and the extension validator, then invoke the new domain
transactions. Each attempt is a fresh Serializable transaction enclosed by the
existing bounded withSerializableRetry helper, including commit-time failures.

The supplied transaction client flows through authorizeFinancialTransaction:
verified cookie identity -> all required Village scopes -> Village guard ->
tenant-filtered Fund lock -> actor SHARE lock/current session-version, password,
role, membership and tenant checks. Then reread Fund and frozen coverage. No
additional House, Payment, Receipt or allocator locks are required. All retries
repeat the entire authority and eligibility path. Missing scope fails closed.

Extension evaluates vfc_fund_expired(endDate,clock_timestamp()) after locking,
inserts extension history first, updates Fund date/version once and awaits
FUND_EXTENDED. Previous/new versions, dates, actor, time and reason are persisted
on history; the existing audit contract links its extension entity and date/reason
metadata. Closure writes status, closedAt, closedByUserId and version once, then
awaits FUND_CLOSED with acceptedPaymentCount. Any write, audit or deferred failure
rejects the enclosing transaction. No external effect occurs in callbacks.

Expected failures are mapped outside retries with fundActionFailure. Unexpected,
audit, exhausted retry and navigation errors propagate. Closure redirects after
the transaction; extension returns a domain result and the form refreshes after
success. Lifecycle UI queries supply hints only, never authority. Forms carry the
displayed Fund ID/version. Closure confirmation remains irreversible; CLOSED has
no mutation controls. English/Myanmar copy explains expiry and assessed-house
coverage. Phase 3D scope/status guards are reused without changes.

## Authored tests and actual boundaries

- fund-completion.test.ts calls real actions, domain transaction logic and retries.
  DB, authority, audit and navigation are controlled unit boundaries. Includes
  pre/on/post-end closure, no expiry prerequisite, stale version/status rejection,
  extension checks, tenant-scoped coverage, explicit audit payloads, failure
  propagation and simulated retry with a revoked grant. The simulated retry is
  not PostgreSQL concurrency evidence.
- fund-extension-validators.test.ts uses the real validator, invalid calendar
  labels and reason inputs, including leap days and date encoding.
- fund-form-caller.test.ts retains edit/activation tests and adds real rendered
  closure and extension forms. Actions/navigation are boundaries. Static HTML
  assertions do not exercise confirmation clicks, submission or hydration.
- fund-completion.integration.test.ts uses the real actions, authority, audits,
  Prisma adapter and SQL guards in an opted-in disposable database. It covers
  early/on-date closure, snapshot/history preservation, a new eligible house,
  stale extension, current role/membership/password/session denial, foreign targets,
  target attainment with an unpaid assessment, and SQL Yangon midnight boundaries.
  Audit failure is injected by changing only the audit actor to an absent ID;
  preceding Fund/history writes are observed first and structured actor-FK
  diagnostics are required. Final assertions require complete rollback.
- fund-completion-concurrency.integration.test.ts routes requests using
  AsyncLocalStorage to independent Prisma clients with request-specific identity
  and hooks. Actual extension, closure, record, void and Village lifecycle code
  runs. Cookie verification, preflight guards and navigation are boundaries.
  For successful-first operations, hold the first transaction after its real
  writes. A separate raw connection proves exact NOWAIT
  40001/VFC_SCOPE_BUSY_RETRY_TRANSACTION contention and rolls back. A second real
  operation establishes a snapshot, the first commits, then the second resumes
  and must retry in a fresh transaction. Only these committed-revision scenarios
  require exactly two attempts.

  For the two unpaid-closure-first cases, the proxy catches the real
  FundWriteError inside the transaction callback, verifies its exact unpaid
  message, signals the barrier, and waits before rethrowing. At this point the
  real authority/scope/Fund locks are still held. The competing actual payment or
  replacement action starts through the other Prisma client and its first scope
  acquisition fails. A test-only error hook requires structured SQLSTATE 40001
  and the exact VFC_SCOPE_BUSY_RETRY_TRANSACTION diagnostic, then holds error
  propagation until the closure is released and its outer transaction has rolled
  back. Assertions verify the original revision, ACTIVE Fund/version and absence
  of a closure audit before releasing the contender. The contender then aborts
  that attempt and the unchanged production retry wrapper starts a fresh
  transaction. Its retry is caused by confirmed NOWAIT contention, not by the
  rolled-back scope revision; an exact attempt count is not imposed. Transaction
  client identities must be distinct across attempts.

  Closure redirects are checked against exact decoded errors. Payment-first and
  replacement outcomes require assessment/accepted-payment/receipt linkage and
  actor-linked payment/receipt/replacement audits. Suspension requires persisted
  SUSPENDED Village status and its SYSTEM_ADMIN status-change audit, alongside
  the Chief's Fund closure audit.

  No timing sleeps establish ordering. Barriers are raced against early operation
  failure, released in finally, and all immediately observed operations are
  awaited before disconnect. Raw transactions are rolled back. There are no
  background observers. Test-only transaction timeouts are 20 seconds; production
  timeout suitability remains a separate gate.

Concurrency coverage includes extension/extension, extension/closure in both
eligible-state directions, final payment/closure in both orderings, void/closure
in both orderings and closure/Village suspension. A real stale-snapshot test
commits Chief revocation before resuming extension and requires a rechecked denial.
Replacement/closure contention is covered in both orderings after a separately
committed void. A separate sequential case also exercises real Village refusal,
void, failed closure, accepted replacement and successful closure.

## Presentation-only rejection localization (F3)

The existing server error strings/contracts, authorization redirects and exception
propagation are unchanged. FundCompletionError, a client presentation component
in extend-fund-form.tsx, maps an explicit allowlist of Phase 6 messages to EN/MY
translation keys. Both extension results and closure lifecycleError navigation
text use it. Expected date/reason, status/version, expiry, coverage, missing-Fund
and read-only outcomes are localized. Unknown text/objects show common.error and
never expose raw diagnostic text. Unexpected server exceptions still propagate;
they are not caught or converted into successful/domain action results. Session,
password and forbidden redirects retain their existing application handling.

To respect the approved correction file boundary, the concurrency test file also
contains a non-database describe block outside its opt-in database suite. It
renders the real error component and lifecycle actions through TranslationProvider
for every mapped message in EN/MY, checks unknown inputs use the generic message,
and checks closure identity fields and the initial confirmation step. These are
static render tests, not browser-click or hydration verification. Existing
unexpected-error propagation tests remain unchanged.

## Verification limitations and release gates

No tests, typecheck, lint, build, Prisma generation/validation or database operation
was executed. Dependencies and generated client are unavailable in this checkout;
no installation was attempted. The Next.js package documentation directory is
absent; existing form/server-action conventions were followed.

A genuine paid-and-already-expired database fixture cannot be manufactured by
shortening ACTIVE terms or inserting expired payments without violating guards.
Pre/on/post-end closure is covered by real transaction logic with unit fixtures;
early/on-date actual PostgreSQL workflows are authored. Genuine historical
expired-paid closure and expired-Fund void remain authorized historical/staging
verification gates; no constraint bypass or production-clock override was added.
The SQL boundary tests use explicit predicate instants, not an overridden trigger
clock. The application extension path calls the very same canonical predicate.

Retain PostgreSQL rollback/concurrency, adapter diagnostics, cleanup/pool ownership,
production timeout, receipt-allocation race, deployment privileges, Prisma,
automated tests/typecheck/lint/build, browser behavior, activation benchmarks and
Phase 7 compatibility gates. No reporting, dashboard, allocator, financial schema,
payment/void, draft/activation or Phase 3 infrastructure was changed.

The request prohibited Git commands. Initial read-only branch/HEAD/status commands
were inadvertently issued before that restriction was read; no Git state mutation
occurred. Subsequent preservation uses filesystem SHA-256 comparisons and a source
scope/whitespace review, with no further Git commands.

## F1–F3 correction preservation

This correction pass uses filesystem SHA-256 comparisons and unified filesystem
diffs only. No Git command was executed during the correction pass. The earlier
implementation's disclosed Git-command incident above is historical and has not
been removed. No tests, typecheck, lint, build, database operations, dependency
installation or client generation were performed in this pass. Tests are authored
for later verification; no runtime success is claimed.
