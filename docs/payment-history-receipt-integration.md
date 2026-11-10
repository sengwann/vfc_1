# Phase 5 reader completion and receipt integrity

Authored offline; tests, typecheck, lint, build, Prisma and database operations
were not executed. Independent review and later authorized execution are required.

## Production changes

Cash history and receipt detail select Payment.assessment.houseNumberSnapshot and
render that value directly. There is no live-House fallback. The existing required
assessment relationship and tenant constraints provide the trusted linkage.
Payer/collector names, amounts, receipt numbers, statuses and access rules retain
their existing meaning. This does not introduce name snapshots or new schema.

Cash history also selects each Payment's own Fund status. Void controls require
ACCEPTED plus ACTIVE; expiry does not remove the control. Backend authorization,
Fund status, void validation and transactional audit remain authoritative.
No write actions, receipt allocator or transaction infrastructure changed.

## Authored tests and boundaries

- cash-payment-list.test.ts renders the actual list with frozen/live identity
  differences and all approved Payment/Fund combinations, including expired
  ACTIVE. Navigation and the write action are mocked, not UI selection logic.
- cash-payment-caller.test.ts additionally exercises the actual page query and
  rendered history using independent Fund statuses. Existing tests are retained.
- receipt-access.test.ts uses the actual access helper with authenticated identity
  and Collector lookup boundaries. The policy has no target-Village argument;
  per-receipt Village/ownership rejection is exercised by receipt-pages.test.ts.
- receipt-pages.test.ts invokes actual list/detail routes, access helper and
  presentation. Database responses, authenticated identity, Collector lookup and
  framework navigation are controlled. It checks exact query restrictions and
  rendered ACTIVE/VOIDED history, frozen identity, original receipt number and
  ownership/Village/inactive-member denials. It does not prove database execution.
- payment-authorization.integration.test.ts extends existing real-action tests.
  Original Receipt ID/number survive void; replacement has distinct Payment and
  Receipt IDs/numbers and existing audit counts/linkage. The actual historical
  receipt route uses real receipt/session/Collector guards and database reads;
  verified cookie claims remain the existing test boundary. A separate case
  injects the precise AuditLog actor FK failure at PAYMENT_REPLACED only, after
  observing both replacement inserts and two earlier audits. Rollback must leave
  original VOIDED records and the four previous audits unchanged.

## Allocator regression release gate

receipt-allocation.integration.test.ts uses two real recording actions, independent
Prisma clients and AsyncLocalStorage request contexts. Each context supplies its
own trusted Village, signed-claim identity and client across every retry.

The first action holds its transaction after all business/audit writes, before
commit. The second reaches the unchanged allocator with its own snapshot. An
explicit database-observation barrier checks pg_locks and pg_blocking_pids for
the second backend waiting on the first backend's advisory lock before the first
is released. No timing-only sleep establishes the interleaving. The observation
has a bounded deadline; absence of the required dependency fails the test.

Both action outcomes must be success. Assertions require two Payments, two unique
Receipts, correct tenant/assessment/actor relationships and exactly four linked
audits. Generic failures or P2002 are not accepted. Confirmed whole-transaction
retries remain those of production; no new retries or allocator SQL are added.
Every started action is immediately observed, the holder is released in finally,
both operations are awaited and clients disconnected before disposable teardown.

The existing disposable harness requires TEST_DATABASE_URL plus explicit
VFC_ALLOW_MIGRATION_TESTS=1. Never point it at production. The race must occur
within one allocator date prefix; a date-boundary run that cannot establish the
specified advisory wait fails rather than claiming concurrency coverage.

If later execution exposes an allocator defect, retain the exact structured
diagnostics and transaction outcomes, stop, and request separate owner approval
and independent review for a minimal evidence-based correction. The actual
protected allocator path is src/lib/receipts/receipt-number.ts.

## Remaining gates

No runtime result is claimed. Browser interactions/hydration, PostgreSQL locking,
adapter diagnostics, rollback, cleanup and permissions require later execution.
The existing expired-ACTIVE-void historical-data verification, production
activation performance benchmark and all Prisma/typecheck/lint/build gates remain.
Extension/closure belong to Phase 6; legacy reporting compatibility to Phase 7.
