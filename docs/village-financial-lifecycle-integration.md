# Phase 3D Village lifecycle coordination

Every lifecycle transaction acquires the Village financial scope before locking
its Village row, then locks ACTIVE Funds in ID order, then the current actor
User FOR SHARE. Scope acquisition is the real vfc_acquire_villages entry and fails
closed if its bootstrap record is absent. Transactions use the bounded whole-
transaction retry wrapper; current session/version, password gate, role and Chief
membership/tenant checks run again in every attempt. The helper reads verified
cookie claims independently of the global Prisma client. Request tenant reads
before scope acquisition are discovery only; request state is read again after
acquisition. Conditional request updates retain deadline/state race protection.

Suspension and deactivation approval reject any Fund whose status is ACTIVE,
regardless of endDate. Completion also refuses an ACTIVE Fund before writing
COMPLETED/DEACTIVATED. Cancellation, rejection, submission and reactivation retain
their existing state-machine rules and do not apply a generic financial write
ban. Missing-target discovery returns the existing not-found outcome when no
Village scope could exist. ACTIVE-Fund refusals use a specific outcome and the
existing query-string error convention, with English/Myanmar messages.

Village creation is the bootstrap exception to scope-before-parent-row locking:
the Village must first be inserted so the Phase 2 AFTER INSERT trigger can create
its private lock row. The action immediately calls acquireVillageScopes for the
new ID, then rechecks the System Admin before Chief/audit writes. All these writes
share one Serializable transaction. The application never inserts lock records.
Password hashing remains outside retry callbacks.

The existing worker lease store is unchanged. Claiming uses a short SKIP LOCKED
statement/transaction; attempts, leases, errors and notification reconcile metadata
acquire no financial scopes. Only completeDeactivationRequest enters the coordinated
lifecycle transaction. Cancellation/completion serialize through scope acquisition,
then reread request state and use the stored database deadline. Notifications remain
in the existing post-commit service layer. No worker redesign was performed.

Authored coverage includes real authority unit tests; expired ACTIVE Fund guards;
activation/suspension and activation/approval stale-snapshot races, with optional
committed role revocation before retry; cancellation versus worker completion;
lease claims while another connection holds the financial scope; automatic new-
Village bootstrap and missing-scope failure. The new disposable PostgreSQL suite
uses independent clients and explicit promise barriers. It mocks verified session
claims and the global client boundary; the lifecycle bodies, SQL locks and retry
classification are real. Existing state-machine suites mock the new session-aware
authority boundary to retain their original focus; dedicated tests exercise it.

No tests, database operations, Prisma validation, typecheck, lint or build were run.
All authored PostgreSQL scenarios, adapter conflict envelopes and cleanup behavior
remain runtime gates for Qwen. Prior Phase 3C raw-query timeout and shared-harness
cleanup hardening recommendations remain deferred. Deployment role grants and
privilege assertions from Phase 2 are still required before release.
