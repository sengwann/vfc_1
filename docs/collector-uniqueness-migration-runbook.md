# Collector uniqueness migration

Migration `20261128130000_one_active_collector_per_village_period` adds one
partial unique index. It keeps the existing per-user unique index and makes
no changes to assignment rows.

## Before deployment

Confirm the intended database and schema. Use a read-only connection to run
the query below and record the result with the deployment evidence. Keep
database credentials in the deployment environment.

```sql
SELECT "villageId", "year", "month",
       array_agg("id" ORDER BY "id") AS "assignmentIds"
FROM public."CollectorAssignment"
WHERE "isActive" = true
GROUP BY "villageId", "year", "month"
HAVING count(*) > 1
ORDER BY "villageId", "year", "month";
```

If the query returns any rows, stop and present every group to the owner.
Any data correction requires an explicit owner-approved rule. Never
automatically delete or deactivate assignments to make the migration pass.
Capture the approved assignment state before deployment so it can be
compared afterward.

On the verified migration target, run `npm run db:deploy`. The migration
rechecks duplicates while holding a lock that blocks assignment writes
through index creation. Ordinary reads can continue. Schedule the migration
for a window that can tolerate assignment writes waiting for that lock.
When a duplicate is found, the command reports the first conflicting village
and period and all assignment IDs in that group. The query above lists every
group.

## Recover from a failed D01 migration

1. Stop automatic deployment retries. Confirm the target and failed migration
   with `npx --no-install prisma migrate status`. Run the read-only query above,
   present all collisions for owner review, and record the approved resolution.
2. Verify whether Prisma recorded a failed attempt and whether the D01 index
   exists. The duplicate check runs inside a single PostgreSQL statement, so
   the collision failure rolls back completely. The expected failed record
   has no finish or rollback timestamp and zero applied steps. The original
   index should be present and the new index absent.

   ```sql
   SELECT migration_name, started_at, finished_at, rolled_back_at,
          applied_steps_count
   FROM public."_prisma_migrations"
   WHERE migration_name = '20261128130000_one_active_collector_per_village_period'
   ORDER BY started_at;

   SELECT indexname, indexdef
   FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'CollectorAssignment'
     AND indexname IN (
       'CollectorAssignment_villageId_userId_year_month_key',
       'CollectorAssignment_one_active_per_village_period'
     )
   ORDER BY indexname;
   ```

   A partial failure in a non-transactional migration requires inspecting and
   reconciling any persisted changes before resolving migration history.
   Unexpected D01 state, including a new index after a reported failure,
   also requires investigation before retry. `migrate resolve` changes
   Prisma's bookkeeping and does not undo database changes.
3. Apply only the separately approved collision resolution. Rerun the full
   duplicate query and require zero groups. Record the resulting assignment
   rows for the post-migration comparison.
4. After verifying complete rollback and an unresolved failed D01 entry,
   mark that attempt rolled back and retry on the same verified target.

   ```bash
   npx --no-install prisma migrate resolve --rolled-back 20261128130000_one_active_collector_per_village_period
   npm run db:deploy
   ```

   If the read-only preflight stopped deployment before an attempt was
   recorded, run the deployment command after the approved resolution
   without the resolve step.
5. Verify the new attempt has finished and the prior failed entry, if present,
   is marked rolled back. Confirm both indexes exist. The original key is
   unique on `(villageId, userId, year, month)`. The new key is unique on
   `(villageId, year, month)` for rows with `isActive = true`. Compare the
   historical assignment rows against the recorded, approved pre-deployment
   state and account for any separately authorized writes during the window.
