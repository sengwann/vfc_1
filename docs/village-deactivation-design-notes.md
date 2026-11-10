# Village Deactivation Workflow: design notes (Phase 1)

Status: Phase 1 only (schema, migrations, pure rules, input, config, test setup).
Nothing is wired into the UI or any server action yet.

## State model

- `Village.status` (ACTIVE / SUSPENDED / DEACTIVATED) is the lifecycle state.
- `VillageDeactivationRequest.status` (PENDING / APPROVED / REJECTED / CANCELLED / COMPLETED) is the workflow state.
- Read-only means "this village has an APPROVED request". It is not a lifecycle status.
- Transitions live in `src/features/village-deactivation/lib/village-deactivation-rules.ts`.
- The countdown is fixed: `scheduledDeactivationAt = approvedAt + 24h`, written once and enforced by a CHECK constraint.
- The deadline is one instant. Cancel needs `now < deadline`; completion needs `now >= deadline`. Exactly one is possible at any moment, and the CHECK constraints use the same boundary.

## What the database enforces (migration `20261028233100_village_deactivation`)

- One PENDING or APPROVED request per village (partial unique index).
- Per-status field shape (CHECK): required fields are asserted `IS NOT NULL`, because a CHECK passes on NULL.
- Non-blank reasons, `processingAttempts >= 0`, cooldown not before rejection.
- RESTRICT foreign keys: requests and notifications are never deleted with their village or users.
- Notification `dedupeKey` is unique, so delivery is idempotent.
- Timestamps are `TIMESTAMP(3)` in UTC. Raw SQL must use `now() AT TIME ZONE 'UTC'`, not bare `now()`, when compared with these columns.

`CANCEL` and `COMPLETE` are added to `AuditActionType` in their own migration (`20261028233000_add_audit_cancel_complete`), because PostgreSQL cannot use a new enum value in the transaction that adds it.

## Mutation guard design (Phase 2, validated on PostgreSQL 16)

The guard must be two statements inside the mutation's transaction:

1. `SELECT status FROM "Village" WHERE id = $1 FOR SHARE` (existing `lockActiveVillage` pattern),
2. a separate `EXISTS` on an APPROVED request for that village.

A one-statement guard, or a lock-only approval, let a transaction with a stale snapshot commit after read-only began. Approve, cancel and complete therefore start with `UPDATE "Village" SET "updatedAt" = now()` (takes the row lock and bumps the row version), run as Serializable through the existing `withSerializableRetry`. A mutation that started before approval then fails with 40001 and retries into the guard. Lock order stays village, then house.

## Phase 2: the guard and the mutation inventory

`guardVillageWrite(tx, villageId)` in `src/lib/authz/village.ts` replaces `lockActiveVillage` (removed; there is exactly one guard). It returns `{ ok: true }` or `{ ok: false, reason }` where reason is `VILLAGE_INACTIVE` (existing behavior) or `VILLAGE_READ_ONLY`. The decision itself is the pure `evaluateVillageWrite` in `village-deactivation-rules.ts`.

How blocked writes answer (machine-readable, reads untouched):

- Actions that return a result object return `{ success: false, code: "VILLAGE_READ_ONLY", ... }` plus an English fallback message.
- Actions that redirect go back to the same page with `?error=VILLAGE_READ_ONLY`.
- Nothing is gated at route, layout or page level; a test fails if `guardVillageWrite` appears under `src/app`.

The 21 guarded entry points: record cash payment, void payment, assign collector, deactivate collector assignment, activate / close / create / update fund, create / deactivate / reactivate / rename house, approve member, reject member, change head, chief approve first member, chief reject pending member, remove member, submit rejoin request, register villager, update profile.

Decisions applied: Q1 (profile edits blocked while read-only; password, language and sign-out stay allowed) and Q3 (fund create, update and close run in one transaction with the guard and the audit entry).

Behavior changes to know about:

- Before Phase 2, assign/deactivate collector, record/void payment, activate/close/create/update fund, remove member and rejoin did not check the village row at all (the session check made it unreachable in practice). They now also refuse an inactive village inside the transaction.
- Profile edits only block on read-only; an inactive village keeps today's behavior there.
- Registration and rejoin now take the village row lock before the house lock, the same order as every other flow.
- `src/lib/authz/village.ts` imports the pure rules file from the feature folder (no cycle: the rules file has no imports).

Exempt server actions (listed with reasons in `village-write-guard-coverage.test.ts`): login, logout, change password, language settings, village-code lookup, payment-status search, create village, and the three System Admin lifecycle actions (suspend is blocked during the countdown in Phase 4; direct deactivation is removed in Phase 3).

## Phase 4: workflow services

`deactivation-transitions.ts` holds the five transitions as functions that run inside a caller-supplied transaction (so they unit test with a fake client and the worker reuses them). `village-deactivation-service.ts` wraps each in a Serializable transaction with `withSerializableRetry`.

| Transition | Who | From to | Notes |
| --- | --- | --- | --- |
| submit | the Chief of that village (re-read from the database) | new PENDING | village must be ACTIVE; one unresolved request; cooldown after REJECTED |
| approve | System Admin | PENDING to APPROVED | village must be ACTIVE; stores approver, approvedAt and `scheduledDeactivationAt = approvedAt + 24h` in one write; does not change `Village.status` |
| reject | System Admin | PENDING to REJECTED | reason required; stores decision-maker, time, reason, `cooldownEndsAt` |
| cancel | the Chief of that village | APPROVED to CANCELLED | reason required; only strictly before the deadline (the deadline is also in the write's WHERE); never touches `Village.status` |
| complete | system (worker) | APPROVED to COMPLETED | only at or after the stored deadline; sets the village DEACTIVATED, completes the request and audits, in one transaction; idempotent |

Concurrency: approve, cancel and complete start with `UPDATE "Village" SET "updatedAt" = ...` (row lock plus a row-version change), so a Serializable transaction that started from an older snapshot fails with 40001 and is retried. Every request write is conditional on the status that was read. The clock is `clock_timestamp()` from the database. Checked on PostgreSQL 16 with psql: suspend against a concurrent approval, approval against a concurrent suspend, and cancel against complete all end with exactly one winner and a retried loser.

Q5 is implemented in `changeVillageStatus`: `suspend` returns `blocked_by_deactivation` when the village has an APPROVED request, before any write; the admin village page shows a message. Reactivate is unaffected.

Audit: every successful transition writes a request entry (`CREATE` / `APPROVE` / `REJECT` / `CANCEL` / `COMPLETE`, entity `DEACTIVATION_REQUEST`, `outcome: "SUCCESS"`). Approve and cancel also write a village entry with `readOnly: true` / `false`; completion also writes the village `STATUS_CHANGE`. Refused transitions are recorded only where they matter: a cooldown rejection, a non-Chief or non-Admin attempt, and a cancellation at or after the deadline (`outcome: "BLOCKED"`). Routine losers of a race (already approved, not pending) are not audited.

Not in this phase: the server actions (Phase 5), notifications (Phase 6), the worker, its failure bookkeeping (`processingAttempts`, `lastProcessingError`) and due-request lookup (Phase 7), and the UI and audit labels (Phase 8).

## Phase 5: server actions

Four actions in `src/features/village-deactivation/actions/`, each thin: authenticate, parse, call the service, hand the result to `runDeactivationAction`.

| Action | Auth | Input | Service |
| --- | --- | --- | --- |
| `submitDeactivationRequestAction` | `requireChief()` | `reason` (village from the session) | `submitDeactivationRequest` |
| `cancelDeactivationRequestAction` | `requireChief()` | `requestId`, `reason`, `confirm` | `cancelDeactivationRequest` |
| `approveDeactivationRequestAction` | `requireSystemAdmin()` | `requestId` | `approveDeactivationRequest` |
| `rejectDeactivationRequestAction` | `requireSystemAdmin()` | `requestId`, `reason` | `rejectDeactivationRequest` (cooldown from configuration) |

Admins cannot submit or cancel and Chiefs cannot approve or reject: the role check is in the action and again in the transition (the actor is re-read from the database).

Answers follow the lifecycle convention (redirect with a code in the query string): `?notice=submitted|approved|rejected|cancelled` or `?error=<code>`, with `&until=<ISO time>` for `cooldown_active`. Codes: `invalid_request`, `reason_required`, `reason_too_long`, `confirmation_required`, `village_not_active`, `unresolved_request_exists`, `cooldown_active`, `not_pending`, `not_approved`, `deadline_reached`, `busy`. A non-authorized actor gets the existing forbidden redirect. The code to text mapping is Phase 8.

Landing pages are `/village/deactivation` (Chief) and `/admin/deactivation-requests` (System Admin). They do not exist until Phase 8, so until then the redirect ends on a 404. No UI calls these actions yet.

## Q5: suspension during the countdown (decided)

Conflict: a SUSPENDED village blocks Chief access, so suspending during an APPROVED request would leave the Chief unable to cancel before the deadline. Rules 6.6 and 8.5 keep suspension and cancellation separate.

Decision: suspension is blocked while the village has an APPROVED request. Chief cancellation therefore always stays possible, and the rules about suspension are not otherwise changed.

Implementation (done in Phase 4): in `changeVillageStatus`, after the village-row UPDATE, refuse `suspend` with a new outcome (for example `BLOCKED_BY_DEACTIVATION`) when an APPROVED request exists. `reactivate` is unaffected. Approval already requires an ACTIVE village, so an approved request can never sit on a suspended village. Completion still accepts a SUSPENDED village defensively. The guard check runs under the same Serializable transaction and village-row lock as approval, so approve and suspend cannot both commit.

## Worker (Phase 7)

`scripts/deactivation-worker.ts`, loop mode plus `--once`, `FOR UPDATE SKIP LOCKED`, no HTTP cron route, host independent. `server-only` throws under plain Node/tsx, so the worker must import only modules that do not import it, or run with the `react-server` condition.

## Configuration (all optional; a bad value throws)

| Variable | Default | Range |
| --- | --- | --- |
| `DEACTIVATION_REJECTION_COOLDOWN_HOURS` | 24 | > 0 and <= 720 |
| `DEACTIVATION_REMINDER_HOURS` | `12,1` | each > 0 and < 24 |
| `DEACTIVATION_WORKER_INTERVAL_SECONDS` | 60 | 5 to 3600 |
| `DEACTIVATION_WORKER_BATCH_SIZE` | 25 | 1 to 200 |

## Integration tests

Needs a separate PostgreSQL database whose name has a "test" word (for example `vfc_test`).

```
# example: local Docker
docker run -d --name vfc-pg-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 postgres:16

export TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/vfc_test
npm run db:test:prepare      # creates the database if missing, runs prisma migrate deploy
npm run test:integration
```

The helper refuses to run when `TEST_DATABASE_URL` is unset, is the same database as `DATABASE_URL`, has no "test" word in the name, is on a non-local host (unless `TEST_DATABASE_ALLOW_REMOTE=1`), or when `NODE_ENV=production`. It never truncates or resets. Tests use unique ids and delete only their own rows. Without `TEST_DATABASE_URL` the integration tests are skipped, so `npm test` still works.

## Notifications (Phase 6)

In-app only, stored in the `Notification` table. Text is not stored: `type` plus `params` (village name/code, reason, rejection reason, cooldown end, deadline, reminder offset) let the page render translated text when it reads them (Phase 8).

| Event | Recipients |
| --- | --- |
| Request created | all System Admins |
| Approved | the village's active Chief(s) |
| Rejected | the Chief(s), with the reason and cooldown end |
| Cancelled | all System Admins |
| Completed (automatic) | System Admins only (village users are already blocked) |
| Reminder, T-12h and T-1h (`DEACTIVATION_REMINDER_HOURS`) | Chief(s) and System Admins, only while APPROVED and before the deadline |

How it stays safe:

- **Derived, not event-driven.** `planDeactivationNotifications` (pure) computes what should exist from the stored request state; `syncDeactivationNotifications` inserts what is missing. Every notification has a unique `dedupeKey` (`deact:<requestId>:<event>:<userId>`), and the insert skips duplicates, so repeating delivery (retry, double submit, the worker's reconcile pass) never duplicates anything. A reminder missed while the worker was down is still sent until the deadline, never after.
- **Post-commit and best effort.** The service wrappers call delivery after the transition's transaction commits, outside it. `deliverDeactivationNotifications` catches everything: a failure is logged, recorded as an audit entry (`notificationDelivery: "FAILED"`, itself best effort), and never changes, delays or rolls back the workflow. Delivery only inserts `Notification` rows; it never writes village or request state.
- **Retry.** A failed delivery is repaired by running the same sync again. The Phase 7 worker does this for every unresolved and recently resolved request.
- **Independent of sessions.** Notifications are addressed to user ids, so users see them whenever they next sign in.
- Read helpers (`listNotificationsForUser`, `countUnreadNotifications`, `markNotificationsRead`) are scoped by `userId` in the query. The mark-as-read action and UI are Phase 8.

Known behavior: because the plan is derived from current recipients, a System Admin or Chief added later receives the earlier events' notifications on the next sync. This is harmless and arguably useful.

## Known side effects of Phase 1

- The audit filter dropdown lists enum values from Prisma, so `CANCEL` and `COMPLETE` appear there as raw names until Phase 8 adds labels (same as the existing `LOGIN_THROTTLED`).
- The `DEACTIVATION_REQUEST` audit entity type and its metadata type are deferred to Phase 4. Adding the entity now would also add an unlabeled entry to the entity filter.

## Worker (Phase 7)

`scripts/deactivation-worker.ts`, a plain Node process (no dependency on the web host or any user session).

```
npm run worker:deactivation        # loop, a pass every DEACTIVATION_WORKER_INTERVAL_SECONDS (default 60)
npm run worker:deactivation:once   # one pass then exit; code 0 clean, 1 if anything failed or was blocked
```

Needs `DATABASE_URL` (read from `.env` if present). Run it under whatever your host provides: systemd, Docker, a Kubernetes Deployment (loop) or CronJob (`--once` every minute), PM2, a Replit deployment, or plain cron. It handles SIGINT/SIGTERM by finishing the current pass. Configuration errors stop it at start. A pass that fails (for example the database is down) is logged and the loop continues.

`--conditions=react-server` in the npm scripts: shared code imports `server-only`, which throws outside a Next.js server build unless that export condition is set. It is only a marker, so this is safe. It could not be run in the authoring environment (no `node_modules`), so confirm with `npm run worker:deactivation:once` first.

What a pass does:

1. **Claim.** `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)` takes APPROVED requests whose stored deadline has passed (database clock), counts an attempt in `processingAttempts`, and stamps `lastProcessingAt`. A claimed request is not claimed again for 5 minutes (`CLAIM_LEASE_SECONDS`), so concurrent workers do not take the same request. Validated on PostgreSQL 16: only due, unclaimed rows are returned; a row locked by another session is skipped without waiting.
2. **Complete.** Each claimed request goes through `completeDeactivationRequest` (the Phase 4 transition: village DEACTIVATED, request COMPLETED, audits, one Serializable transaction, notification after commit). It is idempotent: a request cancelled or completed in the meantime returns `NOT_APPROVED` and nothing changes. A failure on one request does not stop the rest.
3. **Failure bookkeeping.** An exception stores a truncated message in `lastProcessingError` and releases the claim so the next pass retries. A non-completable state that is not simply "already resolved" (for example the village was already DEACTIVATED) is stored as `blocked: <reason>` and keeps the lease, so it is retried every 5 minutes instead of every pass. Both are visible in the request row.
4. **Notification reconcile.** For PENDING and APPROVED requests and ones changed within 48 hours, it runs the idempotent notification sync (Phase 6). That is what sends the T-12h and T-1h reminders, and what repairs a delivery that failed earlier. A problem here never prevents completion: completion runs first.

Timing: with the default 60 second interval a village is deactivated up to about a minute after its deadline, never before it. Lower `DEACTIVATION_WORKER_INTERVAL_SECONDS` for tighter timing. Cancellation stays strictly before the deadline regardless of worker lag, because the transition compares against the stored deadline, not against whether the worker has run.

Not covered by the worker: it does not alert when it is not running. Overdue APPROVED requests (deadline passed, still APPROVED) are the signal; the Phase 8 admin page lists them.

## UI, translations and audit labels (Phase 8)

Pages (both are reachable in every workflow state, including read-only; the rules forbid route-level gating, and what a page shows is only a convenience because every action re-checks on the server):

- `/village/deactivation` (Chief only, `requireChief`): request form when the village is ACTIVE and nothing is open; "waiting for approval" while PENDING; while APPROVED the read-only explanation, a live countdown to the stored deadline, and the cancel form (reason plus confirmation) until the deadline; the last rejection or cancellation with its reason, and the cooldown end when one is running. Notifications card with "mark all as read".
- `/admin/deactivation-requests` (System Admin): open requests with approve and reject (reason required) forms for PENDING ones, the countdown for APPROVED ones, an "overdue" warning when the deadline has passed and the worker has not completed it yet, the worker's last processing error when there is one, the 20 most recent decisions, and the notifications card.
- Every village page shows a read-only banner while a request is APPROVED. The Chief gets a link to the cancel page.
- Admin village detail shows an alert linking to the requests page while a request is open.

Navigation and attention: System Admins get a "Deactivation requests" item with a badge for PENDING requests. The Chief gets a "Deactivation" item (flagged while a request is open) and a Needs Attention entry for PENDING and APPROVED. The Chief's notification summary has a new `deactivationStatus` field.

Feedback: the actions redirect with `?notice=` / `?error=` / `?until=`. `resolveFeedback` maps known codes to translated text, formats the cooldown end, and shows nothing for unknown codes (query text is never rendered).

Notifications are rendered by `describeNotification` from the stored type and params in the reader's language. Stored text (village name, reasons) is substituted in a single pass and displayed as plain text. `markNotificationsReadAction` takes the user from the session, never the form, and only changes that user's own read marks (so it works during read-only; it is listed as exempt in the guard-coverage test).

The countdown is display only. It starts from the server's time and ticks from that offset, so a wrong device clock does not skew it, and reaching zero changes nothing by itself.

Audit: labels for the `CANCEL` and `COMPLETE` actions, the `DEACTIVATION_REQUEST` entity (resolved to the village code), all workflow metadata keys, request statuses and outcome values. Timestamp metadata is shown in Yangon time. Unknown keys still fall back to a readable form.

Translations: 81 new keys in English and Burmese (`deact.*`, `audit.*`, `nav.*`, `shell.attention.*`). The Burmese text is a first draft; have a native speaker review the wording. Tests check that both languages have every key and the same placeholders.
