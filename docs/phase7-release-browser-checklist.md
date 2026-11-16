# Genuine-session browser verification

Status: NOT VERIFIED. No browser runner dependency is configured or added.
Use only an operator-controlled app process on a live verified disposable child.
Create login-capable synthetic users through approved setup; do not use production
accounts or correctness-fixture placeholder passwords. Supply credentials securely.
Record release SHA, browser version, locale, viewport, run and exact fixture IDs.
Use separate browser profiles for roles; do not merely change a mocked role.

For every case record expected values/IDs, actual result, sanitized server evidence
and screenshots where useful. Run English and Myanmar, desktop and narrow mobile.

| Case | Action and required result |
| --- | --- |
| Chief | Login; dashboard, list, detail and reconciliation show the same named financial metrics from the fixture manifest. Target attainment is separate from household completion. |
| Collector | Lifetime total label and amount; cash records include permitted historical/CLOSED Funds; record form still uses current eligible ACTIVE Fund. |
| Villager | Own member status and receipts only. Verify PAID, UNPAID, NOT ASSESSED and NO HOUSEHOLD with four legitimate identities. Null assessment values must not become zero debt. |
| Former Collector | Cash refused; receipts limited to personally paid records. |
| System Admin | Platform audit permitted; village Chief reconciliation/lifecycle/cash access is not gained. |
| Tenant boundary | Paste second-village Fund, receipt, audit and reconciliation URLs and replay their action IDs. Generic denial; no foreign names, options, household association or amount. |
| Date/filter | Yangon payment-day boundaries, invalid/reversed/repeated dates, Fund/status combinations, recovery text; filters survive navigation and reset pagination on apply. |
| Pagination | Traverse >20 cash/>50 receipts including timestamp ties; compare complete ID set, no loss/duplication. Exercise older/newer, filter-mismatched cursor and stale filtered anchor restart. |
| Payment | Hydrated form validation; exact household assessment; partial rejection; one successful submit and duplicate click/replay yields one accepted Payment/Receipt pair with correct audit. |
| Void/replacement | Confirm/cancel interactions; original receipt identity retained and VOIDED; replacement distinct; only accepted money/coverage in summaries. |
| Receipt | List/detail/back navigation retains permitted Fund/date/status context and original identities. |
| Closure | Confirmation click, cancel, valid completion and refresh; unpaid closure denied; CLOSED has no mutation controls; persisted actor/time displayed accurately. |
| Lifecycle/audit | Extension dates/reason/versions/current actor names, attribution caveat, scoped audit list/detail/reset/pagination. Escaped reasons render as text. |
| Reconciliation | Clean valid case; allowed incomplete actor evidence explicitly uncertain with metrics; no invented financial balance or repair controls. |
| Concurrent refresh | Change Fund version between page reads; localized recovery in both languages and native GET refresh. Never display mixed-version data. |
| Session gates | Revoke assignment/membership, increment session version or require password change through legal setup in the child; existing tabs/actions reauthorize. |
| Browser mechanics | Hydration, focus/error messages, confirmation clicks, mobile overflow and navigation work; inspect console/network for unexpected errors and data disclosure. |

Also record No Household/Not Assessed without assigning another user's browser ID.
Unexpected errors must propagate to normal error handling, not successful results.
Whole-page server timings: repeated genuine authenticated requests, reference
compute and sample count, target p95 <=3s; record separately from reader timings.
Stop app/workers and close sessions before owned-branch disposal. Incomplete
checklist remains NOT VERIFIED; running the runner's browser mode does not pass it.
