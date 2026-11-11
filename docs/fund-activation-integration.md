# Phase 4: drafts, activation and frozen assessments

Authored offline; no tests, Prisma commands or databases executed in this phase.
This increment requires independent review and the later Qwen verification stage.

## Draft contract

Existing create `totalAmount` and edit `targetAmount` form fields both mean the
village-wide target. They pass through the preserved Phase 1 validators and map
explicitly to `Fund.villageTargetAmount`. No assessment is calculated or persisted
on draft creation/edit. Drafts are permitted when no eligible Houses exist.
Only DRAFT terms can be edited; the rendered version must match, and each edit
increments termsVersion. Existing names are input-field compatibility only, never
an adapter for old persisted per-House target data.

## Activation transaction

The retry wraps the entire Serializable Prisma transaction, including commit.

1. Acquire the trusted server-context Village scope.
2. Discover ACTIVE Fund IDs and eligible House IDs in this scope. Eligibility is
   active House plus at least one ACTIVE member in the same Village.
3. Invoke Phase 3B authority with the complete target/ACTIVE Fund and House sets.
   Its established order is scope, Village, sorted Funds, sorted Houses using
   FOR NO KEY UPDATE, then actor User. No additional House locks follow actor
   locking. Authorization/session/version/password/tenant checks rerun on retry.
4. Under these locks, check DRAFT status, submitted termsVersion and absence of
   another ACTIVE Fund. Re-read target, eligibility and House display identity.
5. Calculate using Phase 1 calculateFundAssessment. Reject zero eligibility or
   assessments above 10,000,000 MMK. Village target remains bounded at the existing
   approved 1,000,000,000 MMK input limit.
6. Insert one assessment per eligible House while the Fund is still DRAFT. Do not
   skip duplicates. The approved database trigger forbids snapshot insertion after
   activation, so inserts must precede the status update.
7. Set ACTIVE, frozen count/assessment, database-clock snapshotAt and incremented
   termsVersion in one update. Await the FUND_ACTIVATED summary audit.

Total assessment and rounding surplus are exactly derived from the frozen count,
assessment and unchanged target; the schema intentionally has no duplicate stored
total/surplus columns. Audit stores the summary using the approved singular
`totalAssessment` field. No live House count is used after activation.

Draft events are DRAFT_CREATED/DRAFT_UPDATED with Fund/Village/actor linkage.
Audit or snapshot insertion failures propagate and abort all writes. Expected
business errors are mapped outside the retry, session errors redirect to login,
password restrictions to change-password, and other authority errors to forbidden.
Unknown database/audit/navigation errors remain observable. Activation redirects
after the transaction and displays its expected failure via activationError.

## Caller integration and phase limits

Edit and activation forms submit the displayed termsVersion and Fund ID.
The edit reader selects villageTargetAmount. The detail reader only replaces its
removed database-field selection and supplies version/error data to lifecycle
controls; its existing presentation prop `targetAmount` receives the village-wide
target. No reporting formulas, aggregate definitions, dashboard, search, payment,
receipt allocator, extension or closure behavior is redesigned in this increment.
Other legacy reporting readers/writers remain a later-phase compatibility gate.

The creation hint now explains that assessment calculation happens at activation.
The local node_modules/next/dist/docs directory was absent; existing form/server
action conventions were retained without introducing new framework APIs.

## Authored verification

fund-write.test.ts invokes actual actions, domain calculation and retry code with
mocked database, authority and audit boundaries. It covers target validation,
draft separation, stale terms, authorization mapping, exact/ceiling division,
100001/100, rounding, single/max/excessive assessments, zero eligibility, duplicate
activation, existing ACTIVE Fund, tenant mismatch and audit-error propagation.

fund-activation.integration.test.ts uses the real actions, authority, retries,
audit service and database constraints. Only signed-identity/preflight/navigation
and Prisma connection routing are controlled. The existing disposable harness is
gated by TEST_DATABASE_URL and VFC_ALLOW_MIGRATION_TESTS=1. It covers persisted
drafts, real mixed eligibility, snapshot identity, later House/member exclusion,
audit summaries, specific injected failures with rollback and authority revocation.
Concurrent activation uses independent Prisma connections, explicit barriers,
an exact 40001/VFC_SCOPE_BUSY_RETRY_TRANSACTION probe and a real stale-snapshot
retry. Every background promise is observed, barriers are released in finally,
unfinished raw transactions rolled back and operations awaited before disconnect.

fund-form-caller.test.ts renders the real edit/lifecycle components and checks
their hidden Fund ID/version fields. Action and navigation boundaries are mocked;
HTML serialization is modeled and no browser event or hydration is exercised.

No tests have been run. Required later gates include Prisma generation/validation,
typecheck/lint/build, all new unit/integration tests, browser form submissions,
actor revocation ordering, commit-time deferred validation and security assertions.
The previously documented cross-Village receipt allocator race remains unchanged.
