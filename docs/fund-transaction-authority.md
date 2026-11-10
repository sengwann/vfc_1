# Phase 3B — transactional authority and mandatory financial audit

This increment supplies helpers and authored tests only. Existing actions have
not adopted them. Phase 3C–3F and later financial flows remain separate increments.
No PostgreSQL, tests, typecheck, lint, build or Prisma validation was run here.

## Authority entry

Inside each fresh retryable transaction, call `authorizeFinancialTransaction`
ONCE, before database decisions or locks, with the target Village, permission,
and complete Fund/House ID sets. This is a single-Village financial entry point;
cross-Village member movement still needs its own complete-scope protocol.
A submitted Village is a target, never proof of access. Actor IDs, session versions,
roles and membership claims are not accepted from forms. The existing cookie JWT
verifier (`session-identity.ts`, re-exported by session.ts) supplies signed identity/version claims, which are
rechecked against the database. This small session export is required because
SessionUser intentionally does not expose the signed session version. The
password-gate source coverage test now tracks use of this entry point too.

Order: Village scope -> Village write guard -> all Funds -> all Houses -> actor
User FOR SHARE -> applicable CollectorAssignment FOR SHARE. Fund/House locks use
Phase 3A's tenant-filtered sorted helpers; House retains FOR NO KEY UPDATE.
All authoritative reads use the supplied interactive transaction client. Scope
acquisition is included rather than relying on a caller's assertion that it ran.
Do not combine this entry with earlier locks or later acquisition of more scopes.
No redirects, notifications, revalidation or global-client queries occur here.

Actor existence, session version, forced password change, active membership,
Village identity and current role are checked again on every retry. Chief-only
operations require the current CHIEF role. Collection and void operations require
an active assignment for the actor and target Village; Chief status never grants
collection by itself. SYSTEM_ADMIN receives no new collection or village-member
privilege. `member` means active Village membership only; it does not authorize
access to an arbitrary House or financial write. Callers must enforce the exact
operation permission, House/payer access, submitted Fund/version and lifecycle
rules in later increments.

The collector period uses database clock_timestamp() after User locking and
Asia/Yangon conversion, shared with the existing collector period utility.
Authority is evaluated at that point in the transaction; it is not a persistent
capability beyond the transaction. Locks last until commit/rollback and block
concurrent actor/assignment mutation. Financial workflows must not update the
actor User after this shared lock; multi-User lifecycle flows need their own
ordered User locking. Existing legacy writers and whole-transaction 40001/40P01
retries still require integration. Do not swallow authorization failures and
continue with writes.

## Audit

`createFinancialAudit` accepts a discriminated event union with mandatory actor,
Fund, Village and event-specific metadata. It derives action/entity type and ID,
whitelists metadata, checks required fields and safe numeric JSON values, and
uses the existing createAuditLog service. Generic audit input retains optional
fundId; unrelated LOGIN/profile audit remains scope-free. The Phase 2 trigger
verifies persisted Fund/Village/entity identity. Domain calculations, amount caps,
receipt/payment pairing and authorization remain transaction-writer obligations.

Events: DRAFT_CREATED, DRAFT_UPDATED, FUND_ACTIVATED (snapshot summary),
PAYMENT_CREATED, RECEIPT_CREATED, PAYMENT_VOIDED, RECEIPT_VOIDED,
PAYMENT_REPLACED, FUND_EXTENDED and FUND_CLOSED. A void requires separate payment
and receipt events. Replacement requires old payment/receipt void events plus
new payment/receipt creation and the replacement link event, all in one transaction.
Activation uses one Fund summary rather than one audit insert per assessment.

Await every mandatory audit insert inside the associated $transaction callback.
The helper does not catch failures or use best-effort audit. Let rejection escape
the callback so the outer transaction rolls back all preceding writes. Never
catch a failed audit and commit the operation. Do not call tryCreateAuditLog for
financial events. Return the outer transaction promise to withSerializableRetry;
external effects run only after it resolves.

## Verification and remaining integration

Unit tests exercise real helpers with database boundaries mocked. Integration
tests replace only the signed-cookie identity source and use real transaction,
locking, constraint and rollback behavior in the existing disposable DB harness.
They are opt-in via TEST_DATABASE_URL and VFC_ALLOW_MIGRATION_TESTS=1 and were NOT
executed. The PrismaPg fixture supplies connection configuration, not an externally
owned pg.Pool; pinned adapter ownership/error behavior still needs runtime review.
Existing deployment privilege assertions and Phase 3A adapter error/pool gates
remain applicable. Production roles are not established by these tests.

Later writers must adopt this entry and correct operation permission, repeat all
reads on retry, use all required financial events atomically, and implement stale
Fund/version, payer/House, snapshot, lifecycle and reporting rules. No current
action is claimed compatible with the Phase 2 schema by this helper-only change.


## Focused review corrections

Transaction authority imports session-identity.ts, village-write-guard.ts and
collector-period.ts directly. These modules do not import the global Prisma
singleton or its legacy authorization modules. session.ts, village.ts and
collector.ts retain compatible re-exports. JWT verification, cookie lookup,
algorithm restriction and secret validation are preserved. A dependency test
poisons the global Prisma module and imports the real authority graph with an
empty DATABASE_URL; no authority helper is mocked in that test.

Concurrency cases cover assignment, session-version, membership and role changes
using a separate raw PostgreSQL connection alongside Prisma transactions. An
explicit barrier holds completed authorization open; NOWAIT probes assert both
its authority-row lock (55P03) and Village scope lock (40001). Only after that
transaction commits does the competing revocation commit; subsequent authority
is denied with its specific domain code. In the reverse direction, a Serializable
snapshot is established before the independent revocation commits. The first
scope acquisition must fail with 40001, the outer transaction callback must run
again, and the fresh attempt must deny the revoked authority. Tests assert two
attempts and two verified-identity reads, not a reused authorization result.
No timing-only sleeps are used. Whole-transaction retry backoff remains unchanged.

The audit rollback test reads back the inserted Fund inside the transaction and
records that it reached the audit step. It requires the exact
AuditLog_actorUserId_fkey diagnostic, or the AuditLog model and structured
actorUserId FK field diagnostic, alongside the FK failure code. An unrelated
Fund/Village FK failure cannot satisfy these conditions. Adapter diagnostic
representation remains an explicit runtime gate; do not loosen the assertion
if the pinned adapter emits another structure without inspecting that evidence.
All event tests now assert explicit actionType and entityType expectations.
These corrections and authored tests have not been executed.

The existing Village guard coverage inventory now names village-write-guard.ts
as the canonical FOR SHARE implementation; its existing re-export is retained.
