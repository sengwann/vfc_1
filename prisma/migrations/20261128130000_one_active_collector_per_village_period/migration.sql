-- Keep this as one statement. PostgreSQL holds the lock through the index build
-- and rolls back on error. Trailing statements can mask the error in Prisma.
DO $$
DECLARE
  collision record;
  collision_detail text;
BEGIN
  -- Block writes during the duplicate check and index build. Reads may continue.
  LOCK TABLE public."CollectorAssignment" IN SHARE ROW EXCLUSIVE MODE;

  SELECT "villageId", "year", "month", array_agg("id" ORDER BY "id") AS assignment_ids
  INTO collision
  FROM public."CollectorAssignment"
  WHERE "isActive" = true
  GROUP BY "villageId", "year", "month"
  HAVING count(*) > 1
  ORDER BY "villageId", "year", "month"
  LIMIT 1;

  IF FOUND THEN
    collision_detail := format('Village %L, year %s, month %s: active assignment IDs %s',
      collision."villageId", collision."year", collision."month", collision.assignment_ids);
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'Cannot enforce one active Collector assignment per village and period. '
        || 'Migration 20261128130000_one_active_collector_per_village_period. '
        || collision_detail || '. Assignment rows were not modified. The new index was not created.',
      DETAIL = collision_detail,
      HINT = 'Run the full duplicate preflight in the Collector migration runbook before retrying.';
  END IF;

  CREATE UNIQUE INDEX "CollectorAssignment_one_active_per_village_period"
  ON public."CollectorAssignment" ("villageId", "year", "month")
  WHERE "isActive" = true;
END $$;
