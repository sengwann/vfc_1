# Phase 7 Task 7.7 — Internal Fund reconciliation

Implemented against baseline 25f51900e6871df92aa7439cfb5f7af3993bc311 with the
uncommitted Tasks 7.3–7.6 preserved. Tests are authored, NOT executed. Typecheck,
ESLint, build, PostgreSQL and browser verification remain pending.

## Boundary and snapshot

An active Chief opens /village/funds/[fundId]/reconciliation from Fund detail.
Reconciliation covers one Fund, never a village-wide search. The reader reuses the
UNCHANGED withChiefFundHistorySnapshot wrapper: Chief preflight, signed identity,
in-snapshot session version/password/role/membership/active-village rechecks;
RepeatableRead, maxWait 2000 ms, timeout 5000 ms, READ ONLY before data reads.
Foreign and missing Funds have the same not-found response. Collector/payer history
permissions do not grant reconciliation access. No write locks, mutation, repair,
backfill, deletion, migrations, dependencies or export functionality are involved.

The reader independently fetches assessments, payments and extensions in batches.
Receipts are read through the Fund's Payments plus known authorized payment IDs,
always with village scope. Audits use authenticated village AND (Fund ID OR typed
entity references to already-authorized record IDs). This detects same-village
misassociated audit Fund links. It does not fetch another village or follow arbitrary
IDs from JSON metadata. Unattributable orphan records outside this association set
cannot be certified by a single-Fund check. No N+1 queries are used.

Each of five datasets has a 10,000-row limit and one-row lookahead. A 10,001st row
marks its dataset incomplete. Audit association coverage also becomes incomplete
if candidate record sets are incomplete. The evaluator receives up to 10,000 rows
per set and explicit completeness flags. It never reports a clean result if an
applicable check is unverified. Missing datasets likewise remain unverified.
The 100-row finding display pagination happens AFTER full evaluation; it never
filters financial inputs. Each page is a fresh snapshot, not a persistent export.

## Rules and outcomes

PASS: all required inputs for the check were available and matched.
DISCREPANCY: an observed inconsistency, including missing mandatory audit evidence
when the searched evidence set is complete. UNVERIFIED: missing/truncated input,
unknown evidence coverage or unavailable actor attribution. NOT_APPLICABLE: no
lifecycle transitions apply to a valid draft. A category can contain both discrepancy
and unverified findings; its summary prioritizes discrepancy, while all findings
remain available. Overall clean requires PASS/NOT_APPLICABLE everywhere.

Frozen assessments are compared with frozen count, uniform amount and the existing
calculateFundAssessment exact rounding. Live House membership/count is not used.
Payment linkage and uniqueness are validated before calculateFundReportingMetrics
runs unchanged. Invalid assessment/payment integrity yields metrics:null. No bad rows
are dropped to manufacture metrics. Receipt/audit inconsistencies can coexist with
valid money/coverage metrics; the UI explicitly warns that metrics do not certify
audit completeness. This is not a cash custody/bank balance certification.

Accepted money comes only from ACCEPTED Payment rows; VOIDED payments contribute
neither money nor household coverage. Household obligations remain independent of
village target remaining. Receipts retain IDs/numbers and must match Payment status.
CLOSED Funds require complete paid-assessment coverage; no mutation controls exist.

All payments require PAYMENT_CREATED; all receipts require RECEIPT_CREATED.
Voided pairs require PAYMENT_VOIDED/RECEIPT_VOIDED with matching reason/linkage and
consistent void actor. PAYMENT_REPLACED is an additional creation annotation, never
another monetary contribution. Predecessors must be voided, in the same frozen
assessment/Fund/village, with matching reason. Self-links, reused predecessors,
cycles and multiple roots are discrepancies. No ordering is inferred from dates/IDs.

Fund version evidence comprises DRAFT_CREATED, DRAFT_UPDATED, FUND_ACTIVATED,
persisted FUND_EXTENDED transitions and FUND_CLOSED when applicable. Versions must
cover the persisted current version without duplicates/gaps or backward phase
transitions. Old draft targets are validated but not compared to the current target;
current draft/activation target evidence must match. Extension records and closure
fields are authoritative; audit never fills missing lifecycle facts. No per-assessment
creation audit is required by current writers. Extra/unmatched evidence is reported
rather than silently certified. Unknown or malformed evidence is not a clean result.
Audit records are indexed by event/entity; all expected cardinalities are checked.

Actor IDs are evidence; historical actors need not still be Chiefs or village members.
No current membership lookup disqualifies them. Null audit actor attribution is
UNVERIFIED. Current User names are not frozen historical names; this caveat is shown.
Metadata, references and reasons render through escaped React text.

## Authored tests and later gates

- Pure evaluator: DRAFT/ACTIVE/CLOSED; exact 100,001/100-house overpayment and 99-MMK
  rounding; assessment/payment faults; receipt mismatch/missing/duplicate linkage;
  void money exclusion; replacement and repeated correction/final-void chains;
  predecessor errors/cycles; creation/void/extension/closure evidence; historical
  draft targets; malformed/missing/duplicate/conflicting evidence; actor unavailability;
  incomplete datasets and input immutability.
- Reader: real unchanged snapshot wrapper with mocked auth/Prisma; options/order,
  Chief/role/session/membership/village changes, foreign Fund denial, bounded batch
  queries, same-village audit association scope, explicit cap-derived uncertainty,
  unexpected errors. These do not verify actual PostgreSQL isolation.
- View/page: EN/MY uncertainty, absent metrics, escaped references, navigation,
  findings pagination after full evaluation, preflight denial and unexpected errors.

Replit must separately run focused tests, earlier-task regressions, typecheck,
ESLint, build and diff check. PostgreSQL gates: concurrent payment correction and
extension/closure, actual read-only/snapshot behavior, timeout/connection recovery,
representative dataset caps and query plans. Browser gates: Chief/non-Chief access,
both languages, mobile layout, discrepancy navigation and metrics/audit distinction.
The 10,000-row limit and 5-second budget require performance measurement. No claim
of execution verification or production readiness is made. Task 7.8 is not started.
