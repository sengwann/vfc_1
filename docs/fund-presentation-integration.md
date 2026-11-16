# Phase 7 Task 7.3 — Dashboard and fund presentation

Implementation baseline: 25f51900e6871df92aa7439cfb5f7af3993bc311.
Implementation is authored and source-reviewed. No automated checks, dependency
installation, Prisma generation, build, database access or browser verification
were performed during this task. Execution and acceptance remain pending.

## Presentation and read boundaries

- Chief fund detail already required requireChief. It still does. Its monetary
  metrics and assessed-household counts now come from getChiefFundReport, as do
  the current Chief dashboard summary metrics. The approved calculator and reader
  are unchanged. Descriptive metadata remains a separate read; version/status
  mismatches show a controlled English/Myanmar recovery state without rendering
  mixed financial/lifecycle data. Its native GET form starts a fresh authenticated
  page request, including without hydration. Unexpected errors still propagate.
  Detail expiry calls the existing SQL predicate with the validated displayed DATE
  label, so a later extension cannot substitute a newer end date into that view.
- The Chief list uses one short Repeatable Read / READ ONLY transaction for fund
  metadata plus one ACCEPTED-payment groupBy across the selected fund IDs. It
  never calls the full report once per item or computes household obligations.
- getMemberCurrentFund accepts no arguments. It requires a Villager session,
  checks signed identity, and rechecks the actor's current session version,
  password, role, membership and active village inside its read-only snapshot.
  Its household ID comes from that actor row, not a browser input or stale shell
  household. It returns only that household's frozen assessment coverage and
  basic current-fund metadata. This is intentionally not a whole-fund report.
- Payment-status search retains Chief / active-collector authorization. It
  rechecks the actor and current Yangon collector assignment inside a read-only
  snapshot. Live house labels support the existing search, but paid/unpaid status
  comes from the frozen assessment and its linked ACCEPTED payments. No
  assessment means NOT_ASSESSED. Duplicate accepted coverage fails closed.
- The only production search-action caller is PaymentStatusSearchSection, used
  on the dashboard and Chief fund detail. It now consumes explicit status values
  and localized expected-error codes instead of boolean-only results/raw English.
- The password-gate source inventory explicitly recognizes the new member reader
  and the existing accepted Chief reader. Both enforce the password gate; no
  authentication production code was changed.

## Metric meanings

Village target, expected frozen assessments, rounding surplus, accepted collection,
outstanding household obligations, remaining village target, excess collection,
paid/unpaid frozen counts and coverage completion remain separate. DRAFT frozen
assessment values remain null and display as not assessed yet. Target progress
and target-reached badges describe the village target, not household completion
or closure authority. The compact list retains target/collection values only.

NO_HOUSEHOLD and NOT_ASSESSED show neither a household obligation amount nor a
payment request. An assessed household with only voided payments is UNPAID;
an ACCEPTED replacement covers that assessment. A household overpayment never
covers another assessment. Recent payments remain historical records, separate
from current household assessment status.

Collector summaries retain their existing all-time scope for that collector
within the current village. Labels explicitly say lifetime; the assignment
month is identified separately. No new period calculation or trend UI was added.
All new labels, states and expected search errors have English and Myanmar copy.

## Authored tests and later verification

Four new unit test files cover member identity/scope/coverage; search permissions,
frozen states and expected errors; page reader wiring and batched list reads;
and actual static rendering in EN/MY, including the mandatory overpayment and
DRAFT examples. Focused correction coverage simulates an extension after the report
snapshot, inspects the expiry predicate's bound displayed DATE, renders both pages'
concurrency recovery in both languages, checks native GET retry targets, and
requires unexpected reader errors to propagate. These use mocked auth/database boundaries and cannot establish
PostgreSQL or browser behavior. The existing translation parity tests apply to
the added dictionary keys. None of these tests has been executed in this task.

After source review, ChatGPT/Replit can run the focused unit suite:

```sh
npm test -- src/features/fund-management/lib/member-fund-query.test.ts src/features/fund-management/actions/search-payment-status.action.test.ts src/features/fund-management/lib/fund-page-readers.test.ts src/features/fund-management/components/fund-presentation.test.ts src/features/fund-management/lib/fund-report-queries.test.ts src/features/fund-management/lib/fund-reporting.test.ts src/features/fund-management/lib/fund-financials.test.ts src/lib/i18n/translations.test.ts src/lib/auth/password-gate-coverage.test.ts
npm run typecheck
npx eslint 'src/app/(village)/village/dashboard/page.tsx' 'src/app/(village)/village/funds/page.tsx' 'src/app/(village)/village/funds/[fundId]/page.tsx' src/features/analytics/components/chief-overview.tsx src/features/analytics/components/collector-overview.tsx src/features/analytics/components/dashboard-types.ts src/features/analytics/components/villager-overview.tsx src/features/fund-management/actions/search-payment-status.action.ts src/features/fund-management/actions/search-payment-status.action.test.ts src/features/fund-management/components/fund-detail-view.tsx src/features/fund-management/components/fund-list.tsx src/features/fund-management/components/fund-summary-card.tsx src/features/fund-management/components/payment-status-search.tsx src/features/fund-management/components/fund-presentation.test.ts src/features/fund-management/components/fund-changed-recovery.tsx src/features/fund-management/lib/household-reporting-types.ts src/features/fund-management/lib/member-fund-query.ts src/features/fund-management/lib/member-fund-query.test.ts src/features/fund-management/lib/fund-page-readers.test.ts src/lib/auth/password-gate-coverage.test.ts src/lib/i18n/en.ts src/lib/i18n/my.ts
npm run build
git diff --check
```

Use installed/generated Prisma client types from the synchronized project. The
Next.js package documentation directory was absent in this workspace; existing
App Router and server-action conventions were followed. No packages were installed.

Browser/runtime gates: check Chief/member/collector views, both languages, mobile
wrapping and accessibility; search submissions and translated failures; DRAFT,
ACTIVE and CLOSED summaries; target reached with unpaid houses; new/unassessed
households and members without houses; void/replacement refresh behavior; stale
metadata races; cross-village and revoked-role/session denial. New transaction
paths require real PostgreSQL verification separately. Do not interpret authored
unit tests or accepted Task 7.2 runtime results as verification of these new paths.

No writer, business rule, schema, migration, dependency, integration-test sandbox,
or database data was changed. Task 7.4 was not started. No Git commit or push was
performed. Runtime work and GitHub publication require the agreed subsequent
verification workflow.
