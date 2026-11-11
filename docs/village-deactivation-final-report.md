# Village Deactivation Workflow: final report

Branch chain: phase1 to phase9 (each branch builds on the previous one; `village-deactivation-phase9` contains everything). Base commit `20153de`. 109 files changed (57 added, 49 modified, 3 deleted).

## 1. Honest status of verification

Nothing in the authoring environment could install `node_modules` or run the real `vitest`, `tsc`, ESLint or Prisma. So:

**Executed successfully**
- 289 tests in 25 test files, using a minimal stand-in for `vitest` (describe/it/expect subset). This covers: the pure rules, config and input parsing, all five transitions against a fake transaction client, result mapping, the action wiring, notification planning and delivery (idempotency, failure isolation), the worker pass, the page helpers and translations, the audit labels, and the static scans (guard coverage inventory, lifecycle-status writers, password gate).
- The migrations (both, plus the whole chain) applied to a throwaway PostgreSQL 16 database; constraints, partial unique index, concurrency of the guard (suspend vs approve, cancel vs complete) and the worker's claim SQL (due only, lease, `SKIP LOCKED`, failure release, reconcile list) were exercised with real SQL there.

**Not executed (please run locally)**
- `npm install`, `npx prisma generate`, `npx prisma validate`, `npm run typecheck`, `npm run lint`, `npm test` (real vitest).
- `npm run test:integration` with `TEST_DATABASE_URL` (three integration files: transitions, guard, notifications, worker).
- `npm run worker:deactivation:once` (the `--conditions=react-server` flag is the standard `server-only` workaround but is unconfirmed here).
- Next.js rendering of the new pages. They were written against the existing components' prop types but never rendered.
- About 13 existing test files that use `vi` or modules the stand-in lacks (for example `change-village-status.test.ts`, the updated register and payment action tests). They need the real runner.

Nothing is claimed as passing beyond the list above.

## 2. Migrations

1. `20261028233000_add_audit_cancel_complete`: adds `CANCEL` and `COMPLETE` to `AuditActionType` (separate migration because enum additions cannot share a transaction with their use).
2. `20261028233100_village_deactivation`: `VillageDeactivationRequest` and `Notification` tables, enums, indexes, hand-written constraints (one open request per village via a partial unique index; per-status CHECKs; 24h deadline CHECK; non-blank reasons; RESTRICT foreign keys; unique notification `dedupeKey`).

Both are additive and were validated on a throwaway database only. Apply with `prisma migrate deploy`. After applying, run `npx prisma migrate diff` and confirm Prisma does not want to drop the partial index.

## 3. Mutation entry point inventory

Canonical guard: `guardVillageWrite(tx, villageId)` in `src/lib/authz/village.ts`. It reads the village status (`FOR SHARE`) and then, in a separate statement, whether an APPROVED request exists, inside the mutation's transaction. A static test fails if a server action is added without being classified.

**Guarded (21):** record-cash-payment, void-payment, assign-collector, deactivate-collector-assignment, activate-fund, close-fund, create-fund, update-fund, create-house, deactivate-house, reactivate-house, update-house-number, approve-member, change-head, chief-approve-first-member, chief-reject-pending-member, reject-member, remove-member, submit-rejoin-request, register-villager, update-profile.

**Exempt, with the reason recorded in the test:** login, logout, change-password, update-settings (language only), validate-village-code and search-payment-status (read-only), the four deactivation actions (they are the workflow), mark-notifications-read (own read marks only), create-village (no village exists yet), suspend-village and reactivate-village (System Admin lifecycle; suspend is blocked during the countdown).

Background processing: the worker never mutates village records except through the completion transition. Notification delivery only inserts `Notification` rows.

Removed: the direct admin deactivation action and dialog (rules: admins must not deactivate directly), and a stale duplicate payment action file.

## 4. Notification mechanism

In-app, stored in the `Notification` table. Derived from the request's stored state by a pure planner, stored with a unique `dedupeKey` and "skip duplicates", after the transition commits and outside its transaction. It never throws and never writes village or request state; a failure is logged and audited. The worker re-runs the same sync every pass, which sends the T-12h and T-1h reminders (configurable) and repairs failed deliveries. Recipients follow the rules, with completion going to System Admins only (your decision). Text is rendered from type and params in the reader's language.

## 5. Rules coverage

| Rule area | How it is met |
| --- | --- |
| 1 to 3 request, approve, reject | Transitions re-check actor, request state and village state in a Serializable transaction. A partial unique index backs "one open request". Rejection cooldown (default 24h) is enforced server-side and recorded. |
| 4 countdown | `scheduledDeactivationAt = approvedAt + 24h`, both stored in UTC, set once by the database clock, protected by a CHECK, never recalculated. |
| 5 read-only | Mutation level only, through the canonical guard that reads the database. No route, layout or navigation gating; a test enforces it. In-flight transactions cannot commit after approval (row-version bump plus Serializable retry, verified on PostgreSQL 16). |
| 6 cancellation | Chief only, reason and confirmation required, strictly before the deadline by the database clock. Does not touch lifecycle status, so it never reactivates a suspended village (suspension is also blocked during the countdown, per your decision). |
| 7 auto deactivation | Host-independent worker with claim, lease, idempotent completion, overdue catch-up after downtime, deadline never recalculated, audit and status in one transaction. |
| 8 lifecycle vs workflow | Separate columns and enums; read-only is derived from the request, never from `SUSPENDED`. |
| 9 preservation | Nothing is deleted. Exceptional recovery is **not implemented** (see section 7). |
| 10 audit | Request creation, decisions, deadline, read-only on and off, cancellation, completion, cooldown and refused transitions, failed processing, notification delivery failures. Append-only service reused. |
| 11 DB and scheduling | Indexes for due lookup and open requests, transactions and conditional writes, no in-process timers as source of truth. |
| 12 notifications | See section 4. |
| 13 tests | Covered by unit tests (run), integration tests (written, not run), and scans, as described in section 1. |

## 6. Remaining deployment and operations requirements

1. **Run the worker.** It does nothing by itself. Host `npm run worker:deactivation` as a long-running process (systemd, Docker, a Kubernetes Deployment, PM2, a Replit deployment), or run `npm run worker:deactivation:once` every minute from cron or a Kubernetes CronJob. It needs `DATABASE_URL`. Without it, approved requests still stay read-only but are never completed, and reminders are only sent at action time.
2. **Monitor it.** The worker does not alert when it stops. The signal is an APPROVED request past its deadline; the System Admin page shows an overdue warning and the last processing error.
3. **Settings (optional).** `DEACTIVATION_REJECTION_COOLDOWN_HOURS`, `DEACTIVATION_REMINDER_HOURS`, `DEACTIVATION_WORKER_INTERVAL_SECONDS`, `DEACTIVATION_WORKER_BATCH_SIZE`. A bad value stops the worker at start and makes the reject action fail loudly rather than use a guess.
4. **Timing.** With a 60 second interval a village is deactivated up to about a minute after its deadline, never before. Cancellation closes at the deadline regardless.
5. **Integration tests** need a separate PostgreSQL database whose name contains "test": set `TEST_DATABASE_URL`, run `npm run db:test:prepare`, then `npm run test:integration`. The helper refuses your development database.

## 7. Known gaps and notes

- **Recovery** of a deactivated village (rules section 9.5 to 9.6) is not implemented; it was not in the approved plan. Normal lifecycle actions cannot reactivate a deactivated village.
- The Burmese text is a first draft and needs native review.
- `README.md` still contains merge-conflict markers from before this work; I left them alone because it was outside scope.
- A village that were somehow already DEACTIVATED with an APPROVED request is refused at completion (`VILLAGE_ALREADY_DEACTIVATED`) and recorded on the request instead of being forced.
- The worker retries a persistent failure every pass, but writes only one audit entry per distinct error to avoid flooding the log.
