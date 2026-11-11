# Phase 3C integration

Every listed House, household, registration and rejoin writer uses the whole
Serializable transaction retry wrapper. The new beginHouseholdWrite entry reuses
Phase 3B verified session claims, transaction-only Village guard and authorization
errors. Phase 3B's financial entry remains unchanged: it cannot accept public
registration or inactive rejoining members and locks the actor before other
Users. This entry instead locks the complete User set in ID order.

Order: Village scope, Village guard, active Funds sorted, complete House set
sorted (FOR NO KEY UPDATE), Users sorted (FOR NO KEY UPDATE), removal-target
assignments sorted (FOR UPDATE), business writes and audit. Discovery reads grant
no authority. The actor's previous House is included for rejoin. A changed
House discovery aborts with structured 40001 and retries the entire transaction.
All these writers are single-Village operations. A current actor in another
Village is rejected; rejoin does not transfer Village membership. No late Village
acquisition is allowed. Cross-Village movement is not introduced in Phase 3C.

Chief House create/reactivate/rename/deactivate operations recheck current Chief
identity/session/membership. Deactivation explicitly rejects any ACTIVE Fund
assessment, including paid Houses. Other existing active/pending member guards
remain. No writer inserts or edits assessment rows or payment relationships.

Head approve/reject/remove/change operations recheck active membership, actual
House identity and current head ownership. Chief first-member and pending-member
decisions recheck current Chief authority, headlessness, target Village, role and
status. First-member activation and claiming head remain atomic. Removal retains
its existing head exclusion and atomic current/upcoming assignment deactivation
and audits; past assignments remain untouched. Assignments are prelocked before
any mutation. Returning a guard denial occurs before writes; all later failures
escape the callback and abort its writes. Existing action-level error/redirect
handling remains outside retry callbacks.

Public registration remains unauthenticated and throttled. Password hashing stays
outside retries. Its Village-code and House lookups discover scope; scope/guard,
Fund and House locks precede creation of a PENDING, unprivileged User. Rejoin
rechecks signed session version, password restriction, Village, current role and
REMOVED/REJECTED state before writing PENDING membership. Neither flow assigns
head automatically. Empty/PENDING-only Houses may remain headless until the Chief
approves their first active member; assessed Houses are protected by the Phase 2
commit constraint and valid head replacement is atomic.

Tests are authored, NOT executed. The disposable integration suite invokes the
actual approveMemberAction, removeMemberAction, changeHeadAction,
deactivateHouseAction and chiefApproveFirstMemberAction where indicated. Their
transaction callbacks, beginHouseholdWrite authorization, whole-transaction retry
helper, SQL locking/constraints and audit writes are real. Other focused cases
call the real household/removal helpers directly to test specific DB protections.
Fund activation uses the existing raw SQL fixture, not a future financial action.

The preflight requireChief and requireHouseholdManagementAccess guards return
mocked trusted request contexts; getSessionIdentity returns mocked verified-claim
inputs. The transactional helper still checks current database authority. Next.js
navigation and revalidation are mocked. These tests do not verify cookie/JWT
cryptography, preflight guards, framework redirects or cache invalidation.

A Prisma proxy replaces the global application client with a Prisma Client for the
opt-in disposable test database. Its transaction hook runs real callbacks and adds
explicit synchronization points; it does not simulate SQL errors or retries. The
Prisma connection and independent pg Client coordinate through promise barriers,
without timing-only sleeps. The test-only retry_probe table creates a real stale
write conflict after successful authorization, followed by a committed Chief-role
revocation and fresh authorization on retry.

Activation-first cases hold a stale household snapshot until activation commits.
Mutation-first cases keep the actual household action holding its Village scope,
assert the competing activation transaction receives exactly
40001 / VFC_SCOPE_BUSY_RETRY_TRANSACTION, and roll that transaction back before
releasing the action. After the action completes, a fresh activation transaction
acquires scope and creates the snapshot. Membership, Head and snapshot state are
asserted. The approved NOWAIT lock implementation is unchanged.

Every concurrently started action/transaction is owned by a cleanup wrapper. It
releases all held barriers, rolls back unfinished raw transactions, and awaits the
background operation before fixture disposal and Prisma disconnection, including
when an operation fails before its barrier. Cleanup errors are reported without
replacing an existing test failure. First-member rollback coverage invokes the
real action, observes its Head assignment before conditional activation fails,
and checks the rolled-back House state and absence of the approval audit entry.

Registration action mocks and focused House-action authorization tests remain
separate coverage. No tests, DB operations, migrations, typecheck, lint or build
were executed during these corrections. PostgreSQL scenarios, adapter conflict
envelopes, cleanup/disposal behavior, privilege assertions and the authored test
harness all require later runtime verification.
