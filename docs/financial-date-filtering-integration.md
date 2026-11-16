# Phase 7 Task 7.4 — Financial date filtering

Implementation baseline: `25f51900e6871df92aa7439cfb5f7af3993bc311`, with the existing
uncommitted Task 7.3 implementation preserved. Implementation and tests are authored;
no tests, typecheck, ESLint, build, database or browser verification were executed.
This document is a handoff for static review and later Replit verification.

## Contract

`src/lib/financial-date-range.ts` is pure and has no database/authentication imports.
It accepts scalar `YYYY-MM-DD` labels (years 0001–9999). Empty strings and undefined
mean omitted bounds. All arrays are rejected, even repeated identical dates or a
single-element array. Non-string values, timestamps, whitespace, impossible dates,
year zero and reversed ranges return explicit errors rather than dropping filters.

The reporting calendar uses the fixed Myanmar business offset UTC+06:30. It does
not attempt historical civil-time reconstruction before Myanmar adopted that
offset. UTC-only calendar arithmetic avoids host timezone and DST dependencies.
The calendar label is validated by round-tripping before conversion.

An inclusive Yangon start becomes `gte` at that day's midnight. An inclusive end
becomes `lt` at the next day's midnight. For 2026-11-15 alone the range is:

```
gte 2026-11-14T17:30:00.000Z
lt  2026-11-15T17:30:00.000Z
```

Audit filtering uses `AuditLog.createdAt`. It does not filter Fund DATE columns,
change payment eligibility, or calculate historical/as-of obligations or balances.
Stored timestamps retain the project's existing UTC convention; no stored data is
converted and no schema/default/session timezone is changed.

## Audit integration and authorization

`AuditFilters.dateFrom/dateTo` are replaced by the discriminated `dateRange` result.
Both known page callers are updated. Village Audit still calls `requireChief`
and derives village scope from its result; Platform Audit still calls
`requireSystemAdmin`. These checks precede validation recovery and report reads.
Existing action/entity filters and scope predicates are retained.

Invalid ranges show localized errors and the shared editable form, with no audit
rows, count query, misleading empty-result state or pagination. The query builder
also throws before either query for an invalid parsed range. Unexpected errors
propagate normally. Date fields use text inputs during validation recovery so browsers do not erase
invalid values from native date controls. Valid requests retain native date inputs. Repeated
parameters show their first value for editing but remain invalid until resubmitted
as single values. Error text and Myanmar-time guidance are available in EN/MY.

Valid reads pass the same `where` object, including `gte/lt`, to findMany and count.
Predicates compare the indexed timestamp directly; no per-row timezone SQL is used.
These existing parallel reads are not a consistent transaction: a concurrent audit
insert can still affect count/list correspondence. Task 7.4 does not redesign that
read architecture or claim snapshot consistency.

Pagination retains valid calendar labels and other existing filters. Applying or
resetting filters retains the existing navigation behavior, omitting `page` so it
returns to page 1. A filter-dependent React key remounts form state when URL filters
change (including back/forward navigation); page-only navigation preserves the form.

## Authored coverage (not executed)

- `src/lib/financial-date-range.test.ts`: exact bounds and endpoint inclusion,
  host timezone independence, leap day/month/year rollover, open bounds, invalid
  scalar formats/calendar dates, reversed ranges and repeated parameters.
- `src/features/audit/lib/audit-date-queries.test.ts`: actual parser/query wiring
  with mocked Prisma; identical row/count predicates, scope/action/entity filters,
  pagination, optional bounds and fail-closed invalid input.
- `src/features/audit/audit-date-pages.test.ts`: actual village/platform pages with
  mocked guards/readers, actual localized static filter rendering in EN/MY,
  invalid/repeated/reversed recovery, preserved editable invalid values, valid
  pagination links, trusted village identity, authorization ordering/denial and
  unexpected error propagation.

Mocked query and static rendering coverage cannot establish PostgreSQL timestamp
mapping, actual browser form behavior, navigation or database boundary inclusion.
No runtime result or production-readiness claim is made.

## Later Replit verification

After static review, the verification owner can execute:

```sh
npm test -- src/lib/financial-date-range.test.ts src/features/audit/lib/audit-date-queries.test.ts src/features/audit/audit-date-pages.test.ts src/features/audit/lib/audit-labels.test.ts src/lib/i18n/translations.test.ts src/lib/auth/password-gate-coverage.test.ts
npm run typecheck
npx eslint src/lib/financial-date-range.ts src/lib/financial-date-range.test.ts src/features/audit/lib/audit-filters.ts src/features/audit/lib/audit-queries.ts src/features/audit/lib/audit-date-queries.test.ts src/features/audit/components/audit-filters-form.tsx src/features/audit/audit-date-pages.test.ts 'src/app/(village)/village/audit/page.tsx' 'src/app/(platform)/admin/audit/page.tsx' src/lib/i18n/en.ts src/lib/i18n/my.ts
git diff --check
```

Run the agreed full Phase 7 verification separately. Check both audit pages in both
languages, mobile error visibility, invalid raw URLs, duplicate parameters, correction,
reset, page reset on apply, back/forward navigation and pagination. Verify real
PostgreSQL UTC timestamp mapping and boundary records using separately authorized
test isolation; never infer it from mocked Prisma calls. Recheck role denial and
cross-village isolation. Task 7.3's original verification gates remain pending.

## Scope boundaries

Collector analytics month attribution remains a separately deferred timezone issue.
Collector lifetime labels/authorization periods, payment/receipt interfaces, Task 7.1
calculations, Task 7.2 readers, Task 7.3 presentation/recovery, writers, schema,
migrations, dependencies and database data are unchanged by this task. No Task 7.5
work, staging, commit or push was performed.
