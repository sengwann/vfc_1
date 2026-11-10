-- Task 2 v1.0. Offline-authored; requires disposable PostgreSQL verification.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL search_path = public, pg_catalog;
-- Serialize the emptiness assertion with every possible old financial writer.
LOCK TABLE "Village", "User", "House", "Fund", "Payment", "Receipt", "AuditLog"
  IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Fund") OR EXISTS (SELECT 1 FROM "Payment")
    OR EXISTS (SELECT 1 FROM "Receipt") OR EXISTS (
      SELECT 1 FROM "AuditLog" WHERE upper("entityType") IN
        ('FUND','PAYMENT','RECEIPT','FUND_HOUSE_ASSESSMENT','FUND_END_DATE_EXTENSION')
        OR "metadata"::text ~* '"(fundId|paymentId|receiptId|assessmentId|villageTargetAmount|targetAmount|totalAmount)"\s*:')
  THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Financial history exists. STOP: separate owner review required; no conversion is authorized.';
  END IF;
END $$;

ALTER TABLE "Fund" RENAME COLUMN "targetAmount" TO "villageTargetAmount";
ALTER TABLE "Fund"
  ADD COLUMN "eligibleHouseCount" INTEGER,
  ADD COLUMN "assessmentPerHouse" INTEGER,
  ADD COLUMN "snapshotAt" TIMESTAMP(3),
  ADD COLUMN "termsVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "closedAt" TIMESTAMP(3),
  ADD COLUMN "closedByUserId" TEXT REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "Fund_target_check" CHECK ("villageTargetAmount" BETWEEN 1 AND 1000000000),
  ADD CONSTRAINT "Fund_dates_check" CHECK ("endDate" >= "startDate"),
  ADD CONSTRAINT "Fund_version_check" CHECK ("termsVersion" > 0),
  ADD CONSTRAINT "Fund_snapshot_check" CHECK (
    ("status" = 'DRAFT' AND "eligibleHouseCount" IS NULL AND "assessmentPerHouse" IS NULL AND "snapshotAt" IS NULL)
    OR ("status" <> 'DRAFT' AND "eligibleHouseCount" IS NOT NULL AND "eligibleHouseCount" > 0
      AND "assessmentPerHouse" IS NOT NULL AND "assessmentPerHouse" BETWEEN 1 AND 10000000
      AND "snapshotAt" IS NOT NULL
      AND "assessmentPerHouse" = (("villageTargetAmount"::bigint - 1) / NULLIF("eligibleHouseCount",0)) + 1)),
  ADD CONSTRAINT "Fund_closed_check" CHECK (
    ("status" = 'CLOSED' AND "closedAt" IS NOT NULL AND "closedByUserId" IS NOT NULL)
    OR ("status" <> 'CLOSED' AND "closedAt" IS NULL AND "closedByUserId" IS NULL));
CREATE UNIQUE INDEX "Fund_id_villageId_key" ON "Fund"("id","villageId");
CREATE UNIQUE INDEX "House_id_villageId_key" ON "House"("id","villageId");
CREATE UNIQUE INDEX "Fund_one_active_per_village" ON "Fund"("villageId") WHERE "status" = 'ACTIVE';

CREATE TABLE "FundHouseAssessment" (
  "id" TEXT PRIMARY KEY, "fundId" TEXT NOT NULL, "houseId" TEXT NOT NULL,
  "villageId" TEXT NOT NULL REFERENCES "Village"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "assessmentAmount" INTEGER NOT NULL CHECK ("assessmentAmount" BETWEEN 1 AND 10000000),
  "houseNumberSnapshot" TEXT NOT NULL CHECK (length(btrim("houseNumberSnapshot")) > 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  UNIQUE ("fundId","houseId"), UNIQUE ("id","fundId","houseId","villageId"),
  FOREIGN KEY ("fundId","villageId") REFERENCES "Fund"("id","villageId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("houseId","villageId") REFERENCES "House"("id","villageId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "FundHouseAssessment_houseId_idx" ON "FundHouseAssessment"("houseId");
CREATE INDEX "FundHouseAssessment_villageId_idx" ON "FundHouseAssessment"("villageId");
ALTER TABLE "Payment" ADD COLUMN "fundHouseAssessmentId" TEXT NOT NULL,
  ADD CONSTRAINT "Payment_amount_check" CHECK ("amount" BETWEEN 1 AND 10000000),
  ADD CONSTRAINT "Payment_void_check" CHECK (
    ("status" = 'ACCEPTED' AND "voidReason" IS NULL)
    OR ("status" = 'VOIDED' AND "voidReason" IS NOT NULL AND length(btrim("voidReason")) > 0)),
  ADD CONSTRAINT "Payment_assessment_fkey" FOREIGN KEY ("fundHouseAssessmentId","fundId","houseId","villageId")
    REFERENCES "FundHouseAssessment"("id","fundId","houseId","villageId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_fundId_fkey",
  ADD CONSTRAINT "Payment_fundId_villageId_fkey" FOREIGN KEY ("fundId","villageId")
    REFERENCES "Fund"("id","villageId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_collectorUserId_fkey",
  ADD CONSTRAINT "Payment_collectorUserId_fkey" FOREIGN KEY ("collectorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Payment_id_villageId_key" ON "Payment"("id","villageId");
CREATE INDEX "Payment_fundHouseAssessmentId_idx" ON "Payment"("fundHouseAssessmentId");
CREATE UNIQUE INDEX "Payment_one_accepted_per_house" ON "Payment"("fundId","houseId") WHERE "status" = 'ACCEPTED';
ALTER TABLE "Receipt" DROP CONSTRAINT "Receipt_paymentId_fkey",
  ADD CONSTRAINT "Receipt_paymentId_villageId_fkey" FOREIGN KEY ("paymentId","villageId")
    REFERENCES "Payment"("id","villageId") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE UNIQUE INDEX "Receipt_paymentId_villageId_key" ON "Receipt"("paymentId","villageId");
CREATE TABLE "FundEndDateExtension" (
  "id" TEXT PRIMARY KEY, "fundId" TEXT NOT NULL,
  "villageId" TEXT NOT NULL REFERENCES "Village"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "previousEndDate" DATE NOT NULL, "newEndDate" DATE NOT NULL,
  "previousTermsVersion" INTEGER NOT NULL CHECK ("previousTermsVersion" > 0),
  "newTermsVersion" INTEGER NOT NULL,
  "changedByUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "changedAt" TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  "reason" TEXT NOT NULL CHECK (length(btrim("reason")) > 0),
  CHECK ("newEndDate" > "previousEndDate"),
  CHECK ("newTermsVersion"::bigint = "previousTermsVersion"::bigint + 1),
  UNIQUE ("fundId","newTermsVersion"),
  FOREIGN KEY ("fundId","villageId") REFERENCES "Fund"("id","villageId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "FundEndDateExtension_villageId_idx" ON "FundEndDateExtension"("villageId");
CREATE INDEX "FundEndDateExtension_changedByUserId_idx" ON "FundEndDateExtension"("changedByUserId");
ALTER TABLE "AuditLog" ADD COLUMN "fundId" TEXT REFERENCES "Fund"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "AuditLog_fundId_idx" ON "AuditLog"("fundId");

-- Exact-key scopes avoid unrelated-village coupling and hash collisions.
CREATE TABLE "VillageFinancialWriteLock" (
  "villageId" TEXT PRIMARY KEY REFERENCES "Village"(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  revision BIGINT NOT NULL DEFAULT 0
);
INSERT INTO "VillageFinancialWriteLock"("villageId") SELECT id FROM "Village";
CREATE TABLE "FundFinancialValidationWork" (
  "transactionId" BIGINT NOT NULL, "scopeType" TEXT NOT NULL CHECK ("scopeType" IN ('FUND','VILLAGE')),
  "scopeId" TEXT NOT NULL, PRIMARY KEY ("transactionId","scopeType","scopeId")
);
REVOKE ALL ON "VillageFinancialWriteLock", "FundFinancialValidationWork" FROM PUBLIC;

-- Invocable transaction entry point for Phase 3. NOWAIT is also used when a
-- legacy writer reaches a trigger after already locking a House/User row.
CREATE FUNCTION vfc_acquire_villages(village_ids text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE scope_id text;
BEGIN
  FOR scope_id IN SELECT DISTINCT x FROM unnest(village_ids) x WHERE x IS NOT NULL ORDER BY x LOOP
    BEGIN
      PERFORM 1 FROM "VillageFinancialWriteLock" WHERE "villageId"=scope_id FOR UPDATE NOWAIT;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='VFC_SCOPE_MISSING';
      END IF;
      UPDATE "VillageFinancialWriteLock" SET revision=revision+1 WHERE "villageId"=scope_id;
    EXCEPTION WHEN lock_not_available THEN
      RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='VFC_SCOPE_BUSY_RETRY_TRANSACTION';
    END;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION vfc_acquire_villages(text[]) FROM PUBLIC;
-- Grant EXECUTE to the actual runtime role during separately approved deployment.

CREATE FUNCTION vfc_bootstrap_village_scope() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  INSERT INTO "VillageFinancialWriteLock"("villageId") VALUES (NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER vfc_00_bootstrap AFTER INSERT ON "Village" FOR EACH ROW EXECUTE FUNCTION vfc_bootstrap_village_scope();

-- One function is used BEFORE (scope acquisition) and AFTER (enqueue) each
-- relevant row. JSON comparisons deliberately exclude password/session/profile
-- changes and deactivation worker lease bookkeeping. AuditLog is not registered.
CREATE FUNCTION vfc_scope_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE before_row jsonb:='{}'; after_row jsonb:='{}'; old_village text; new_village text;
  scope_id text; fund_id text; relevant boolean:=true;
BEGIN
  IF TG_OP<>'INSERT' THEN before_row:=to_jsonb(OLD); END IF;
  IF TG_OP<>'DELETE' THEN after_row:=to_jsonb(NEW); END IF;
  IF TG_OP='UPDATE' THEN
    IF TG_TABLE_NAME='Receipt' AND TG_WHEN='BEFORE' AND
      (after_row-ARRAY['status','updatedAt']) IS DISTINCT FROM (before_row-ARRAY['status','updatedAt'])
    THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Receipt identity is immutable'; END IF;
    IF TG_TABLE_NAME='User' THEN
      relevant:=ROW(before_row->'id',before_row->'villageId',before_row->'houseId',before_row->'membershipStatus',before_row->'role')
        IS DISTINCT FROM ROW(after_row->'id',after_row->'villageId',after_row->'houseId',after_row->'membershipStatus',after_row->'role');
    ELSIF TG_TABLE_NAME='Village' THEN
      relevant:=ROW(before_row->'id',before_row->'status') IS DISTINCT FROM ROW(after_row->'id',after_row->'status');
    ELSIF TG_TABLE_NAME='VillageDeactivationRequest' THEN
      relevant:=ROW(before_row->'villageId',before_row->'status') IS DISTINCT FROM ROW(after_row->'villageId',after_row->'status');
    ELSIF TG_TABLE_NAME='House' THEN
      relevant:=ROW(before_row->'id',before_row->'villageId',before_row->'isActive',before_row->'headOfHouseId',before_row->'houseNumber')
        IS DISTINCT FROM ROW(after_row->'id',after_row->'villageId',after_row->'isActive',after_row->'headOfHouseId',after_row->'houseNumber');
    END IF;
  END IF;
  IF NOT relevant THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
  IF TG_TABLE_NAME='Village' THEN
    old_village:=before_row->>'id'; new_village:=after_row->>'id';
    IF TG_OP='INSERT' AND TG_WHEN='BEFORE' THEN RETURN NEW; END IF;
  ELSE old_village:=before_row->>'villageId'; new_village:=after_row->>'villageId'; END IF;
  IF TG_WHEN='BEFORE' THEN
    PERFORM vfc_acquire_villages(ARRAY[old_village,new_village]);
  ELSE
    FOR scope_id IN SELECT DISTINCT x FROM unnest(ARRAY[old_village,new_village]) x WHERE x IS NOT NULL LOOP
      INSERT INTO "FundFinancialValidationWork" VALUES (txid_current(),'VILLAGE',scope_id) ON CONFLICT DO NOTHING;
    END LOOP;
    IF TG_TABLE_NAME IN ('Fund','FundHouseAssessment','Payment','FundEndDateExtension','Receipt') THEN
      FOR fund_id IN
        SELECT DISTINCT x FROM unnest(CASE WHEN TG_TABLE_NAME='Fund' THEN ARRAY[before_row->>'id',after_row->>'id']
          WHEN TG_TABLE_NAME='Receipt' THEN ARRAY[
            (SELECT "fundId" FROM "Payment" WHERE id=before_row->>'paymentId'),
            (SELECT "fundId" FROM "Payment" WHERE id=after_row->>'paymentId')]
          ELSE ARRAY[before_row->>'fundId',after_row->>'fundId'] END) x WHERE x IS NOT NULL
      LOOP
        INSERT INTO "FundFinancialValidationWork" VALUES (txid_current(),'FUND',fund_id) ON CONFLICT DO NOTHING;
      END LOOP;
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['Village','User','House','Fund','FundHouseAssessment','Payment','Receipt','FundEndDateExtension','CollectorAssignment','VillageDeactivationRequest'] LOOP
    EXECUTE format('CREATE TRIGGER vfc_00_scope BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION vfc_scope_change()',table_name);
    EXECUTE format('CREATE TRIGGER vfc_10_enqueue AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION vfc_scope_change()',table_name);
  END LOOP;
END $$;

CREATE FUNCTION vfc_validate_work() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE consumed boolean;
BEGIN
  IF NEW."transactionId"<>txid_current() THEN RAISE EXCEPTION USING MESSAGE='VFC_WORK_WRONG_TRANSACTION'; END IF;
  DELETE FROM "FundFinancialValidationWork" WHERE "transactionId"=NEW."transactionId"
    AND "scopeType"=NEW."scopeType" AND "scopeId"=NEW."scopeId" RETURNING true INTO consumed;
  IF consumed IS NOT TRUE THEN RETURN NULL; END IF;
  IF NEW."scopeType"='FUND' THEN
    IF EXISTS (SELECT 1 FROM "Fund" f WHERE f.id=NEW."scopeId" AND (
      (f.status='DRAFT' AND EXISTS (SELECT 1 FROM "FundHouseAssessment" a WHERE a."fundId"=f.id))
      OR (f.status<>'DRAFT' AND ((SELECT count(*) FROM "FundHouseAssessment" a WHERE a."fundId"=f.id)<>f."eligibleHouseCount"
        OR EXISTS (SELECT 1 FROM "FundHouseAssessment" a WHERE a."fundId"=f.id AND a."assessmentAmount"<>f."assessmentPerHouse")))
      OR (f.status='CLOSED' AND EXISTS (SELECT 1 FROM "FundHouseAssessment" a WHERE a."fundId"=f.id AND NOT EXISTS (
        SELECT 1 FROM "Payment" accepted_payment WHERE accepted_payment."fundHouseAssessmentId"=a.id AND accepted_payment.status='ACCEPTED')))))
    THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='VFC_SNAPSHOT_OR_CLOSURE_INVALID'; END IF;
    IF EXISTS (SELECT 1 FROM "Payment" payment_row LEFT JOIN "Receipt" r ON r."paymentId"=payment_row.id
      WHERE payment_row."fundId"=NEW."scopeId" AND (r.id IS NULL OR (payment_row.status='ACCEPTED') IS DISTINCT FROM (r.status='ACTIVE')))
    THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='VFC_PAYMENT_RECEIPT_INCONSISTENT'; END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM "Fund" f JOIN "Village" v ON v.id=f."villageId" WHERE f."villageId"=NEW."scopeId" AND f.status='ACTIVE'
      AND (v.status<>'ACTIVE' OR EXISTS (SELECT 1 FROM "VillageDeactivationRequest" r WHERE r."villageId"=v.id AND r.status='APPROVED')))
    THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='VFC_ACTIVE_FUND_VILLAGE_PROTECTED'; END IF;
    IF EXISTS (SELECT 1 FROM "Fund" f JOIN "FundHouseAssessment" a ON a."fundId"=f.id
      JOIN "House" h ON h.id=a."houseId" LEFT JOIN "User" head_member ON head_member.id=h."headOfHouseId"
      WHERE f."villageId"=NEW."scopeId" AND f.status='ACTIVE' AND (NOT h."isActive" OR head_member.id IS NULL
        OR head_member."membershipStatus" IS DISTINCT FROM 'ACTIVE' OR head_member."houseId" IS DISTINCT FROM h.id
        OR head_member."villageId" IS DISTINCT FROM h."villageId"))
    THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='VFC_ACTIVE_HOUSE_HEAD_PROTECTED'; END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER vfc_validate_work AFTER INSERT ON "FundFinancialValidationWork"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vfc_validate_work();

CREATE FUNCTION vfc_payment_window(start_day date,end_day date,at_time timestamptz) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT (at_time AT TIME ZONE 'Asia/Yangon')::date BETWEEN start_day AND end_day
$$;
CREATE FUNCTION vfc_fund_expired(end_day date,at_time timestamptz) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT (at_time AT TIME ZONE 'Asia/Yangon')::date>end_day
$$;
REVOKE ALL ON FUNCTION vfc_bootstrap_village_scope(),vfc_scope_change(),vfc_validate_work() FROM PUBLIC;

CREATE FUNCTION vfc_fund_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Fund history cannot be deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT' THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Fund must start as DRAFT'; END IF;
  ELSE
    IF OLD."status" = 'CLOSED' THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Closed fund is immutable'; END IF;
    IF NEW."id" <> OLD."id" OR NEW."villageId" <> OLD."villageId" THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Fund identity is immutable'; END IF;
    IF OLD."status" = 'ACTIVE' THEN
      IF NEW."status" NOT IN ('ACTIVE','CLOSED') OR
        ROW(NEW."villageTargetAmount",NEW."eligibleHouseCount",NEW."assessmentPerHouse",NEW."snapshotAt",NEW."startDate",NEW."name",NEW."description") IS DISTINCT FROM
        ROW(OLD."villageTargetAmount",OLD."eligibleHouseCount",OLD."assessmentPerHouse",OLD."snapshotAt",OLD."startDate",OLD."name",OLD."description")
      THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Activated financial terms are frozen'; END IF;
      IF NEW."endDate" IS DISTINCT FROM OLD."endDate" AND NEW."status" <> 'ACTIVE' THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Cannot extend and close together'; END IF;
    ELSIF NEW."status" NOT IN ('DRAFT','ACTIVE') THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Invalid fund transition'; END IF;
    IF NEW."termsVersion"::bigint <> OLD."termsVersion"::bigint + 1 THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Fund mutation must increment termsVersion once'; END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Village" v WHERE v.id=NEW."villageId" AND v.status='ACTIVE')
    OR EXISTS (SELECT 1 FROM "VillageDeactivationRequest" r WHERE r."villageId"=NEW."villageId" AND r.status='APPROVED')
  THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Village is not writable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vfc_fund_guard BEFORE INSERT OR UPDATE OR DELETE ON "Fund" FOR EACH ROW EXECUTE FUNCTION vfc_fund_guard();

CREATE FUNCTION vfc_financial_record_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE f "Fund"; payment_row "Payment"; fid text;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Financial history cannot be deleted'; END IF;
  IF TG_TABLE_NAME='Receipt' THEN
    IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['status','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','updatedAt'])
    THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Receipt identity is immutable'; END IF;
    SELECT * INTO STRICT payment_row FROM "Payment" WHERE id=NEW."paymentId";
    fid:=payment_row."fundId";
  ELSE fid:=NEW."fundId"; END IF;
  SELECT * INTO STRICT f FROM "Fund" WHERE id=fid FOR UPDATE;
  IF f.status='CLOSED' THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Closed fund is immutable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "Village" WHERE id=f."villageId" AND status='ACTIVE')
    OR EXISTS (SELECT 1 FROM "VillageDeactivationRequest" WHERE "villageId"=f."villageId" AND status='APPROVED')
  THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Village is not writable'; END IF;
  IF TG_TABLE_NAME='FundHouseAssessment' THEN
    IF TG_OP<>'INSERT' OR f.status<>'DRAFT' THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Assessment snapshot is immutable'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "House" h WHERE h.id=NEW."houseId" AND h."villageId"=NEW."villageId"
      AND h."isActive" AND h."houseNumber"=NEW."houseNumberSnapshot" AND EXISTS (
        SELECT 1 FROM "User" u WHERE u."houseId"=h.id AND u."villageId"=h."villageId" AND u."membershipStatus"='ACTIVE'))
    THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='House is not eligible'; END IF;
  ELSIF TG_TABLE_NAME='Payment' THEN
    IF f.status<>'ACTIVE' THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Payment requires ACTIVE fund'; END IF;
    IF TG_OP='INSERT' THEN
      IF NEW.status<>'ACCEPTED' OR NOT vfc_payment_window(f."startDate",f."endDate",clock_timestamp())
      THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Payment window is closed'; END IF;
      IF NOT EXISTS (SELECT 1 FROM "User" WHERE id=NEW."payerUserId" AND "villageId"=NEW."villageId" AND "houseId"=NEW."houseId" AND "membershipStatus"='ACTIVE')
        OR (NEW."collectorUserId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" WHERE id=NEW."collectorUserId" AND "villageId"=NEW."villageId" AND "membershipStatus"='ACTIVE'))
      THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Payment actor does not belong to house/village'; END IF;
    ELSE
      IF OLD.status<>'ACCEPTED' OR NEW.status<>'VOIDED' OR
        (to_jsonb(NEW)-ARRAY['status','voidReason','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','voidReason','updatedAt'])
      THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Only accepted-to-voided payment transition is allowed'; END IF;
    END IF;
    IF EXISTS (SELECT 1 FROM "FundHouseAssessment" a WHERE a.id=NEW."fundHouseAssessmentId") AND NOT EXISTS (SELECT 1 FROM "FundHouseAssessment" a WHERE a.id=NEW."fundHouseAssessmentId" AND NEW.amount>=a."assessmentAmount")
    THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Payment below assessment'; END IF;
  ELSIF TG_TABLE_NAME='Receipt' THEN
    IF f.status<>'ACTIVE' THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Receipt requires ACTIVE fund'; END IF;
    IF TG_OP='UPDATE' AND (OLD.status<>'ACTIVE' OR NEW.status<>'VOIDED' OR
      (to_jsonb(NEW)-ARRAY['status','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','updatedAt']))
    THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Receipt identity is immutable'; END IF;
  ELSE
    IF TG_OP<>'INSERT' OR f.status<>'ACTIVE' OR NEW."previousEndDate"<>f."endDate" OR NEW."previousTermsVersion"<>f."termsVersion"
      OR NOT vfc_fund_expired(f."endDate",clock_timestamp())
      OR NOT EXISTS (SELECT 1 FROM "User" WHERE id=NEW."changedByUserId" AND role='CHIEF' AND "villageId"=f."villageId" AND "membershipStatus"='ACTIVE')
      OR NOT EXISTS (SELECT 1 FROM "FundHouseAssessment" a WHERE a."fundId"=f.id AND NOT EXISTS (
        SELECT 1 FROM "Payment" p WHERE p."fundHouseAssessmentId"=a.id AND p.status='ACCEPTED'))
    THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Invalid end-date extension'; END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['FundHouseAssessment','Payment','Receipt','FundEndDateExtension'] LOOP
    EXECUTE format('CREATE TRIGGER vfc_record_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION vfc_financial_record_guard()',t);
  END LOOP;
END $$;

CREATE FUNCTION vfc_fund_transition_check() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF OLD.status='DRAFT' AND NEW.status='ACTIVE' THEN
    -- Equality in both directions: active houses with >=1 active member only.
    IF EXISTS (SELECT 1 FROM "House" h WHERE h."villageId"=NEW."villageId" AND
      (h."isActive" AND EXISTS (SELECT 1 FROM "User" u WHERE u."houseId"=h.id AND u."villageId"=h."villageId" AND u."membershipStatus"='ACTIVE'))
      IS DISTINCT FROM EXISTS (SELECT 1 FROM "FundHouseAssessment" a WHERE a."fundId"=NEW.id AND a."houseId"=h.id))
    THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Activation snapshot does not match eligible houses'; END IF;
    IF EXISTS (SELECT 1 FROM "FundHouseAssessment" a JOIN "House" h ON h.id=a."houseId"
      WHERE a."fundId"=NEW.id AND a."houseNumberSnapshot"<>h."houseNumber")
    THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Activation house display snapshot does not match'; END IF;
  END IF;
  IF OLD.status='ACTIVE' AND NEW."endDate" IS DISTINCT FROM OLD."endDate" THEN
    IF NOT EXISTS (SELECT 1 FROM "FundEndDateExtension" e WHERE e."fundId"=NEW.id
      AND e."previousEndDate"=OLD."endDate" AND e."newEndDate"=NEW."endDate"
      AND e."previousTermsVersion"=OLD."termsVersion" AND e."newTermsVersion"=NEW."termsVersion")
    THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='End-date change requires matching extension history'; END IF;
  ELSIF OLD.status='ACTIVE' AND NEW.status='ACTIVE' THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='ACTIVE fund may only extend or close';
  END IF;
  IF NEW.status='CLOSED' AND NOT EXISTS (SELECT 1 FROM "User" WHERE id=NEW."closedByUserId"
    AND role='CHIEF' AND "villageId"=NEW."villageId" AND "membershipStatus"='ACTIVE')
  THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Closure requires village Chief'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER vfc_transition_check AFTER UPDATE ON "Fund" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION vfc_fund_transition_check();
CREATE FUNCTION vfc_extension_applied() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Fund" f WHERE f.id=NEW."fundId" AND f."endDate"=NEW."newEndDate" AND f."termsVersion"=NEW."newTermsVersion")
  THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Extension history must update Fund in the same transaction'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER vfc_extension_applied AFTER INSERT ON "FundEndDateExtension" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION vfc_extension_applied();

CREATE FUNCTION vfc_financial_audit_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE fid text; vid text;
BEGIN
  IF TG_OP<>'INSERT' THEN
    IF OLD."fundId" IS NOT NULL OR upper(OLD."entityType") IN ('FUND','PAYMENT','RECEIPT','FUND_HOUSE_ASSESSMENT','FUND_END_DATE_EXTENSION')
    THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Financial audit history is append-only'; END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  END IF;
  CASE upper(NEW."entityType")
    WHEN 'FUND' THEN SELECT id INTO fid FROM "Fund" WHERE id=NEW."entityId";
    WHEN 'PAYMENT' THEN SELECT "fundId" INTO fid FROM "Payment" WHERE id=NEW."entityId";
    WHEN 'RECEIPT' THEN SELECT p."fundId" INTO fid FROM "Receipt" r JOIN "Payment" p ON p.id=r."paymentId" WHERE r.id=NEW."entityId";
    WHEN 'FUND_HOUSE_ASSESSMENT' THEN SELECT "fundId" INTO fid FROM "FundHouseAssessment" WHERE id=NEW."entityId";
    WHEN 'FUND_END_DATE_EXTENSION' THEN SELECT "fundId" INTO fid FROM "FundEndDateExtension" WHERE id=NEW."entityId";
    ELSE fid:=NEW."fundId";
  END CASE;
  IF upper(NEW."entityType") IN ('FUND','PAYMENT','RECEIPT','FUND_HOUSE_ASSESSMENT','FUND_END_DATE_EXTENSION')
    AND (fid IS NULL OR NEW."fundId" IS DISTINCT FROM fid)
  THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Financial audit requires matching Fund and entity'; END IF;
  IF NEW."fundId" IS NOT NULL THEN
    SELECT "villageId" INTO STRICT vid FROM "Fund" WHERE id=NEW."fundId";
    IF NEW."villageId" IS DISTINCT FROM vid THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Audit village mismatch'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vfc_audit_guard BEFORE INSERT OR UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION vfc_financial_audit_guard();

-- TRUNCATE bypasses row DELETE triggers. Runtime roles must not own tables or
-- disable triggers. Explicitly refuse TRUNCATE on financial history tables.
CREATE FUNCTION vfc_no_financial_truncate() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Financial history cannot be truncated'; END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['Fund','FundHouseAssessment','Payment','Receipt','FundEndDateExtension','AuditLog','VillageFinancialWriteLock','FundFinancialValidationWork'] LOOP
    EXECUTE format('CREATE TRIGGER vfc_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION vfc_no_financial_truncate()',t);
  END LOOP;
END $$;
COMMIT;
