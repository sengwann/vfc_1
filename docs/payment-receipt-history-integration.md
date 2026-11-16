# Phase 7 Task 7.5 — Complete payment and receipt history

Authored on baseline `25f51900e6871df92aa7439cfb5f7af3993bc311`, preserving the
uncommitted Task 7.3/7.4 implementation. No automated tests, typecheck, ESLint,
build, database connections or runtime checks were executed. Static review and
later Replit verification remain required.

## Reader and authorization boundaries

The cash recording loader/form remains the existing ACTIVE-fund workflow. History
is loaded independently and rendered even without an ACTIVE fund. History filters
never change the form's Fund ID/version, frozen assessment or payer choices. The
page checks that recording/history contexts have the same village before rendering.

`getCashHistory` and `getReceiptHistory` accept only URL filter/navigation parameters.
They perform existing access preflight, verify signed identity, and rederive current
session/password/membership/village/assignment authority inside a short transaction:
RepeatableRead, maxWait 2000 ms, timeout 5000 ms; SET TRANSACTION READ ONLY is the
first statement. No financial scope/write locks or full Fund reports are used.

Cash requires a currently active Collector and returns village-wide cash history.
Receipts grant active Chiefs village-wide access, active Collectors collected-or-
paid access, and ordinary active Villagers payer-only access. A former Collector
with no current assignment receives payer-only receipt access and cannot read cash.
The receipt header uses the access level returned by the transaction, not stale
preflight role metadata. Each request reauthorizes; cookies, not query parameters,
supply identity. SYSTEM_ADMIN, inactive membership/village, changed session/password
and wrong-village identity fail through the existing login/change-password/forbidden
routes. The current Yangon assignment period uses the existing authorization helper.

All filters and seeks are ANDed with that base scope. Fund options are Fund
ID/name metadata selected through the same authorized Payment relationships (and
existing Receipts for receipt history), independent of date/status filters. No
unbounded Payment/Receipt history rows are loaded. The Fund metadata selector itself
is not paginated; review its cardinality/performance as the number of funds grows.
Foreign, missing and inaccessible Fund IDs produce the same unavailable state.

## Date, status and identity contract

Both histories use Payment.createdAt for ordering and date filtering. Receipt.createdAt
is not the filter basis. Task 7.4's unchanged helper applies strict calendar validation
and inclusive Myanmar dates as UTC gte / exclusive-next-day lt boundaries.
Fund, status and navigation arrays are also rejected. Default status includes both
ACCEPTED and VOIDED. Receipt filters use Payment.status; badges retain Receipt.status.
The reader throws on mismatched committed receipt/payment status rather than changing
or hiding it. Original Receipt IDs/numbers remain unchanged and original links are
used; replacement records retain their separate identities. These are current-status
history views, not historical/as-of balance reconstruction or financial reports.

Phase 5 frozen house labels, void reasons and void controls remain: only ACCEPTED
payments in their own ACTIVE Fund show the control, including expired ACTIVE Funds.
CLOSED history is readable but does not gain a void control. Writers still recheck
all authority and lifecycle rules; no writer, allocator, schema or migration changes.

## Keyset navigation

Cash: Payment.createdAt DESC, Payment.id DESC; 20 rows.
Receipts: linked Payment.createdAt DESC, Receipt.id DESC; 50 rows.

Each query fetches size+1 rows. Older navigation seeks strictly below the last visible
tuple. Newer navigation seeks above the first tuple, orders ascending, takes size+1,
and reverses the visible rows for display. This makes timestamp ties deterministic.
No offset or total-count query is used. Default ID comparison/order uses PostgreSQL's
column collation consistently; real-database verification remains necessary.

Cursors contain a version, anchor ID and SHA-256 binding to history kind and normalized
Fund/date/status filters. They contain no authority or trusted timestamp. They are
unsigned navigation hints, not credentials. Decoding is bounded and malformed or
filter-mismatched hints are rejected. Every anchor is resolved again inside the
current authorized, filtered snapshot; no anchor fields are disclosed by recovery.
A missing/nonmatching anchor gives localized restart recovery. No query broadening.

Transactions do not persist across browser requests. Concurrent voids/replacements
can change current-status membership. Newer insertion does not shift an older seek,
but this is not a frozen multi-page export. An empty traversal page always has a
First page action; invalid/stale navigation offers Restart history. Applying filters
uses a native GET form without cursor/direction fields. Navigation preserves filters;
clear/restart returns to unfiltered history. EN/MY cover filters, time basis, recovery
and navigation. The filter form is keyed by request parameters for URL state changes.

## Authored tests (not executed)

- history-filters.test.ts: strict/shared dates, defaults, repeated parameters and
  invalid Fund/status/navigation inputs.
- history-cursor.test.ts: all filter-binding dimensions, history-kind separation,
  bounded malformed tokens and no cursor authority fields.
- history-queries.test.ts: real reader with mocked auth/Prisma, transaction options/
  READ ONLY ordering, scoped Fund options/rows, receipt policies, former Collectors,
  session/password/tenant/membership changes, invalid dates, generic inaccessible
  Funds, status integrity, keyset seek/order/limits and stale/binding recovery.
  Independent in-memory DB boundaries exercise complete equal-timestamp traversal,
  reverse navigation and a newer insertion. They cannot prove PostgreSQL execution.
- history-panel.test.ts: real EN/MY static rendering, recovery hides history,
  invalid input remains editable, filter form omits cursor, links preserve filters.
- Existing cash-payment-caller.test.ts: retained recording form/action regressions;
  history-reader boundary is mocked, plus no-ACTIVE-fund historical rendering.
- Existing receipt-pages.test.ts: actual reader/access/list/detail wiring with
  mocked transaction queries, retained original identities, scope and detail denial.
- password-gate-coverage.test.ts explicitly inventories the new reader, which
  checks the password gate both before and inside its snapshot.

## Later Replit verification

After static review, the verification owner can run:

```sh
npm test -- src/features/payment-history/lib/history-filters.test.ts src/features/payment-history/lib/history-cursor.test.ts src/features/payment-history/lib/history-queries.test.ts src/features/payment-history/components/history-panel.test.ts src/features/cash-payment/components/cash-payment-caller.test.ts src/features/cash-payment/components/cash-payment-list.test.ts src/features/receipt-viewing/receipt-pages.test.ts src/features/receipt-viewing/lib/receipt-access.test.ts src/lib/financial-date-range.test.ts src/lib/auth/password-gate-coverage.test.ts src/lib/i18n/translations.test.ts
npm run typecheck
npx eslint src/features/payment-history 'src/app/(village)/village/cash/page.tsx' 'src/app/(village)/village/receipts/page.tsx' src/features/cash-payment/components/cash-page-view.tsx src/features/cash-payment/components/cash-payment-list.tsx src/features/cash-payment/components/cash-payment-caller.test.ts src/features/receipt-viewing/components/receipt-list.tsx src/features/receipt-viewing/receipt-pages.test.ts src/lib/auth/password-gate-coverage.test.ts src/lib/i18n/en.ts src/lib/i18n/my.ts
git diff --check
```

Real PostgreSQL gates: >20/>50 rows with ties across pages; older/newer traversal;
concurrent inserts and status correction; stale authorized anchor vs foreign anchor;
actual payment date vs different receipt issue time; readonly/snapshot behavior and
connection timeouts/recovery. Existing indexes do not cover all composite orderings;
inspect bounded query plans with representative data before proposing any index work.
No migration is included or authorized here. Use separately authorized test isolation.

Browser gates: both languages, mobile wrapping, native GET filters, invalid and
repeated URLs, reset, stale recovery, back/forward navigation, no ACTIVE Fund,
CLOSED history, original/replacement receipt links, role/session/assignment revocation
and hidden foreign Fund options. Preserve Task 7.3/7.4 verification gates. Runtime
results from earlier phases do not verify these new readers. No Task 7.6, staging,
commit or push was performed.
