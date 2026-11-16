# Phase 7 Task 7.6 — Lifecycle and Fund audit history

Implemented on baseline `25f51900e6871df92aa7439cfb5f7af3993bc311`, preserving
uncommitted Tasks 7.3–7.5. Tests are authored but not executed. Typecheck, ESLint,
build, database and browser verification are pending. No runtime acceptance is claimed.

## Sources and access

Fund detail and `/village/funds/[fundId]/audit` remain Chief-only. Collectors and
ordinary Villagers gain no access to lifecycle/audit information. Each reader uses
Chief preflight, verified session identity and an in-transaction recheck of session
version, password gate, role, membership and active village. Browser village/user
parameters never authorize anything. Fund queries require ID and authenticated
village; foreign and missing Funds both give not-found. No shared request cache.

The shared history snapshot wrapper starts RepeatableRead, maxWait 2000 ms,
timeout 5000 ms, with SET TRANSACTION READ ONLY before any reads. It takes no
financial write locks. The Fund audit rows/count share that snapshot and exact
ANDed Fund/village/action/entity/date predicates. Existing village/platform audit
readers retain their prior transaction behavior.

FundEndDateExtension supplies extension dates, reason, actor, changedAt and version
transition. Fund.closedAt and closedByUserId supply closure facts. Audit metadata
never fills missing lifecycle facts. Each displayed extension and closure has a
bounded audit-evidence check: missing, duplicate, conflicting or overflow evidence
shows a localized warning. Evidence reads are capped at 201 rows; above 200 all
associated evidence is treated as uncertain. No duplicate timeline entries arise
from matching audit events. No historical data repair or mutation occurs.

Actor names come from CURRENT User records. They are not frozen historical names;
the UI states this. A historical actor need not still be a Chief or member. Missing
financial attribution is unavailable, never automatically labeled System. Existing
nonfinancial system-event presentation is retained. Original frozen assessments and
house labels are neither queried for reconstruction nor modified.

Extension dates are stored DATE calendar labels, formatted without timezone shifts.
Event timestamps use Asia/Yangon. Audit date filters use the unchanged Task 7.4
fixed UTC+06:30 business calendar, strict dates and exclusive next-day upper bounds,
against AuditLog.createdAt. Closure time validation uses metadata.closedAt, not
AuditLog.createdAt (insertion time can differ).

## Consistency and pagination

Lifecycle reads fetch 21 extensions, display 20, ordered by newTermsVersion DESC,
id DESC. The unique ID breaks ties; version order is authoritative even if event
clocks tie. Older cursors contain only an extension ID and are resolved again under
Fund/village scope before a version/ID seek. Repeated, malformed or absent anchors
give restart recovery without broadening. A first-page link is always present.

The detail page compares the lifecycle snapshot's Fund ID, village, version and
status with the unchanged Task 7.2 report before rendering financial metrics.
Expected concurrent changes use Task 7.3 recovery. These are separate snapshots;
there is no claim of a single transaction spanning them. Expiry remains derived
from the validated displayed end date through the canonical database function.
Financial/payment changes after a read can naturally make a page stale.

Fund audit reuses the existing parser, filter form, list, pagination and detail
route. The route embeds Fund scope, so applying/clearing filters retains it. Audit
pagination retains the existing 25-row offset contract with createdAt DESC, id DESC.
Ties are deterministic; concurrent insertions can shift offset pages between
requests. This is not a frozen export. No changes to payment-history keysets.

Recorded draft/activation/extension/closure events expose version traceability.
This does not reconstruct every previous Fund field: old draft descriptions and
dates are not all captured in existing audit metadata. No synthetic history is made.

## Authored coverage and later verification

- fund-lifecycle-history.test.ts: real reader with mocked DB/auth, session and role
  revocation, tenant checks, transaction ordering/options, authoritative extension
  facts, bounded version/ID pagination, stale/repeated anchors, missing/duplicate/
  conflicting/overflow evidence, closure metadata and unexpected errors.
- fund-lifecycle-history.test.ts (components): EN/MY facts, unavailable actors,
  current-name caveat, evidence warning, escaped reason, pagination and no controls.
- fund-audit-queries.test.ts: shared authorization boundary contract, exact same
  row/count scope/date predicates, deterministic bounded pages and invalid dates.
- fund-audit-pages.test.ts: EN/MY page wiring, Fund scope, detail URLs, preserved
  filters, invalid/repeated-date recovery, preflight denial and unexpected errors.
- Existing fund-page-readers.test.ts: adapted metadata boundary, preserving DRAFT,
  concurrent extension, version/status recovery in both languages and expiry tests.
- Existing audit-labels and password-gate tests: financial localization and reader
  inventory. These tests remain unexecuted.

Replit should run these focused tests plus Tasks 7.3–7.5 regressions, typecheck,
focused ESLint, build and diff check separately. Browser gates include mobile layout,
both languages, Chief/non-Chief access, multiple lifecycle pages, audit apply/reset,
missing evidence, original receipt links and CLOSED funds with no mutation controls.
PostgreSQL gates include concurrent extension/closure between reads, actual READ ONLY
and snapshot behavior, connection timeout/recovery and representative query plans.
Existing Fund/extension/audit indexes need measurement before proposing index work.
No schema, migration, writer, dependency, export or reconciliation change is included.
