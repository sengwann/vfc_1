import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { TestDatabase } from "./test-database";

import { createAuditLog, AuditEntityType } from "@/lib/audit";
import { AuditActionType } from "@prisma/client";
import { getCurrentPeriod } from "@/lib/authz/collector-period";

export type PerformanceProfile = "primary" | "comparison" | "concentrated" | "boundary";
export interface FixtureVillage { id: string; chief: string; collector: string; payer: string; former: string; active: string; draft: string; closed: string[]; houses: number; amount: number; paid: number }
export interface PerformanceFixture { run: string; profile: PerformanceProfile; people: number; households: number; fundsPerVillage: number; villages: FixtureVillage[]; boundaryAuditFund?: string; villageAuditIds: string[] }
export function fixtureShape(profile: PerformanceProfile, history = 24, boundaryRows = 10000) {
  if (!Number.isInteger(history) || history < 1 || history > 120) throw new RangeError("History must be 1–120 Funds per village");
  if (![9999, 10000, 10001].includes(boundaryRows)) throw new RangeError("Boundary must be 9999, 10000 or 10001");
  return Array.from({ length: profile === "boundary" ? 1 : 10 }, (_, i) => ({
    people: profile === "boundary" ? boundaryRows : profile === "concentrated" ? (i === 0 ? 1100 : 100) : 200,
    houses: profile === "boundary" ? boundaryRows : profile === "comparison" ? 50 : profile === "concentrated" ? (i === 0 ? 330 : 30) : 60,
    history: profile === "boundary" ? 0 : history,
  }));
}
async function transaction<T>(db: TestDatabase, body: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await db.pool.connect();
  try { await c.query("BEGIN"); const value = await body(c); await c.query("COMMIT"); return value; }
  catch (error) { try { await c.query("ROLLBACK"); } catch (rollback) { throw new AggregateError([error, rollback], "Fixture and rollback failed"); } throw error; }
  finally { c.release(); }
}
/** Only call with startReportPostgresSandbox().db after its ownership handshake.
 * All fixture transactions commit before readers run. Disposal is branch-only. */
export async function buildPerformanceFixture(db: TestDatabase, profile: PerformanceProfile, history = 24, boundaryRows = 10000, combined = false): Promise<PerformanceFixture> {
  const shapes = fixtureShape(profile, history, boundaryRows);
  const run = `perf-${randomUUID()}`;
  const result: PerformanceFixture = { run, profile, people: 0, households: 0, fundsPerVillage: history, villages: [], villageAuditIds: [] };
  for (const [index, shape] of shapes.entries()) {
    const v = `${run}-v${index}`, chief = `${v}-u0`, collector = `${v}-u1`;
    await transaction(db, async (c) => {
      await c.query('INSERT INTO "Village"(id,"villageCode",name,"updatedAt") VALUES ($1,$1,$1,now())', [v]);
      await c.query(`INSERT INTO "House"(id,"villageId","houseNumber","updatedAt") SELECT $1||'-h'||i,$1,'H'||i,now() FROM generate_series(0,$2::int-1) i`, [v, shape.houses]);
      await c.query(`INSERT INTO "User"(id,"villageId","houseId",role,"membershipStatus",name,"passwordHash","updatedAt")
        SELECT $1||'-u'||i,$1,$1||'-h'||(i % $3::int),CASE WHEN i=0 THEN 'CHIEF'::"UserRole" ELSE 'VILLAGER'::"UserRole" END,'ACTIVE','Synthetic '||i,'unused-benchmark-password',now() FROM generate_series(0,$2::int-1) i`, [v, shape.people, shape.houses]);
      await c.query(`UPDATE "House" SET "headOfHouseId"=$1||'-u'||substring("houseNumber" from 2) WHERE "villageId"=$1`, [v]);
      const period=getCurrentPeriod();
      await c.query(`INSERT INTO "CollectorAssignment"(id,"villageId","userId",year,month,"updatedAt") VALUES ($1,$2,$3,$4,$5,now())`, [`${v}-assignment`, v, collector,period.year,period.month]);
      await c.query(`INSERT INTO "CollectorAssignment"(id,"villageId","userId",year,month,"isActive","updatedAt") VALUES ($1,$2,$3,$4,$5,false,now())`, [`${v}-former`,v,`${v}-u3`,period.year,period.month]);
    });
    // Record the real synthetic Village creation through the append-only service.
    // Multiple annotations provide a bounded populated platform-audit workload.
    result.villageAuditIds.push(...await recordSyntheticVillageAudit(db, v, chief, run));
    const village: FixtureVillage = { id: v, chief, collector, payer: `${v}-u2`, former: `${v}-u3`, active: "", draft: `${v}-draft`, closed: [], houses: shape.houses, amount: 1001, paid: 0 };
    if (combined && profile !== "boundary") throw new RangeError("Combined stress requires boundary profile");
    for (let f = 0; f <= shape.history; f++) {
      const id = `${v}-f${f}`, closed = f < shape.history;
      const paid = closed ? shape.houses : profile === "boundary" ? (combined ? 1 : 0) : Math.max(2, Math.floor(shape.houses / 2));
      const surplus = Math.min(99, shape.houses - 1);
      const target = shape.houses * 1001 - surplus;
      await transaction(db, async (c) => {
        const audit = async (event: string, entity: string, entityId: string, action: string, metadata: Record<string, unknown>, actor = chief) => {
          await c.query(`INSERT INTO "AuditLog"(id,"villageId","fundId","entityType","entityId","actionType","actorUserId",metadata)
            VALUES ($1,$2,$3,$4,$5,$6::"AuditActionType",$7,$8::jsonb)`, [`${id}-log-${randomUUID()}`, v, id, entity, entityId, action, actor, JSON.stringify({ event, ...metadata })]);
        };
        await c.query(`INSERT INTO "Fund"(id,"villageId",name,"villageTargetAmount","startDate","endDate","updatedAt") VALUES ($1,$2,$1,$3,current_date-20000,CASE WHEN $4::boolean THEN current_date+1 ELSE current_date-$5::int END,now())`, [id,v,target,closed,combined?boundaryRows:2]);
        await audit("DRAFT_CREATED","FUND",id,"CREATE",{ termsVersion: 1, villageTargetAmount: target });
        await c.query(`INSERT INTO "FundHouseAssessment"(id,"fundId","villageId","houseId","assessmentAmount","houseNumberSnapshot") SELECT $1||'-a'||substring("houseNumber" from 2),$1,$2,id,1001,"houseNumber" FROM "House" WHERE "villageId"=$2`, [id,v]);
        const activated = await c.query<{ snapshotAt: Date }>(`UPDATE "Fund" SET status='ACTIVE',"eligibleHouseCount"=$2,"assessmentPerHouse"=1001,"snapshotAt"=now(),"termsVersion"=2 WHERE id=$1 RETURNING "snapshotAt"`, [id,shape.houses]);
        await audit("FUND_ACTIVATED","FUND",id,"STATUS_CHANGE",{ termsVersion: 2, villageTargetAmount: target, eligibleHouseCount: shape.houses, assessmentPerHouse: 1001, totalAssessment: shape.houses*1001, roundingSurplus: surplus, snapshotAt: activated.rows[0].snapshotAt.toISOString() });
        if (!closed) {
          for (let step=1;step<=(combined?boundaryRows:1);step++) {
          const e=`${id}-extension-${step}`;
          const previousVersion=step+1;
          const dayOffset=combined && step<boundaryRows ? -boundaryRows+step : 1;
          const extension=await c.query<{previousEndDate:Date;newEndDate:Date}>(`INSERT INTO "FundEndDateExtension"(id,"fundId","villageId","previousEndDate","newEndDate","previousTermsVersion","newTermsVersion","changedByUserId",reason)
            SELECT $2,id,"villageId","endDate",current_date+$5::int,$4::int,$4::int+1,$3,'Synthetic extension' FROM "Fund" WHERE id=$1 RETURNING "previousEndDate","newEndDate"`,[id,e,chief,previousVersion,dayOffset]);
          await c.query(`UPDATE "Fund" SET "endDate"=current_date+$2::int,"termsVersion"="termsVersion"+1 WHERE id=$1`,[id,dayOffset]);
          await audit("FUND_EXTENDED","FUND_END_DATE_EXTENSION",e,"UPDATE",{extensionId:e,previousEndDate:extension.rows[0].previousEndDate.toISOString().slice(0,10),newEndDate:extension.rows[0].newEndDate.toISOString().slice(0,10),termsVersion:previousVersion+1,reason:"Synthetic extension"});
          // Enforce each historical extension while its matching Fund version is
          // current; deferred extension guards cannot validate only the last one.
          if (combined) { await c.query("SET CONSTRAINTS ALL IMMEDIATE"); await c.query("SET CONSTRAINTS ALL DEFERRED"); }
          }
        }
        for (let h = 0; h < paid; h++) {
          let previous: string | undefined;
          // Every tenth household has two original corrections; all receipt IDs remain.
          const corrections = combined ? boundaryRows-1 : h % 10 === 0 ? 2 : 0;
          for (let attempt = 0; attempt <= corrections; attempt++) {
            const p = `${id}-p${h}-${attempt}`, r = `${p}-receipt`, reason = "Synthetic correction";
            const identity = { paymentId: p, houseId: `${v}-h${h}`, assessmentId: `${id}-a${h}`, amount: 1001 };
            await c.query(`INSERT INTO "Payment"(id,"fundId","villageId","houseId","fundHouseAssessmentId","payerUserId","collectorUserId",amount,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,1001,current_date-($8::int),now())`, [p,id,v,identity.houseId,identity.assessmentId,`${v}-u${h}`,collector, f+1]);
            await c.query(`INSERT INTO "Receipt"(id,"receiptNumber","paymentId","villageId","updatedAt") VALUES ($1,$1,$2,$3,now())`, [r,p,v]);
            await audit("PAYMENT_CREATED","PAYMENT",p,"CREATE",identity,collector);
            await audit("RECEIPT_CREATED","RECEIPT",r,"CREATE",{ paymentId:p,receiptId:r,receiptNumber:r },collector);
            if (previous) await audit("PAYMENT_REPLACED","PAYMENT",p,"CREATE",{ ...identity, previousPaymentId:previous, reason },collector);
            if (attempt < corrections) {
              await c.query(`UPDATE "Payment" SET status='VOIDED',"voidReason"=$2 WHERE id=$1`,[p,reason]);
              await c.query(`UPDATE "Receipt" SET status='VOIDED' WHERE id=$1`,[r]);
              await audit("PAYMENT_VOIDED","PAYMENT",p,"VOID",{ ...identity,reason },collector);
              await audit("RECEIPT_VOIDED","RECEIPT",r,"VOID",{ paymentId:p,receiptId:r,reason },collector);
            }
            previous=p;
          }
        }
        if (closed) {
          const close = await c.query<{ closedAt: Date }>(`UPDATE "Fund" SET status='CLOSED',"closedAt"=now(),"closedByUserId"=$2,"termsVersion"=3 WHERE id=$1 RETURNING "closedAt"`,[id,chief]);
          await audit("FUND_CLOSED","FUND",id,"STATUS_CHANGE",{ termsVersion:3,closedAt:close.rows[0].closedAt.toISOString(),acceptedPaymentCount:paid });
        }
      });
      if (closed) village.closed.push(id); else { village.active=id; village.paid=paid; }
    }
    await transaction(db,async(c)=>{
      await c.query(`INSERT INTO "Fund"(id,"villageId",name,"villageTargetAmount","startDate","endDate","updatedAt") VALUES ($1,$2,$1,1001,current_date-1,current_date+1,now())`,[village.draft,v]);
      const versions=profile === "boundary" ? boundaryRows : 1;
      for(let version=1;version<=versions;version++) {
        if(version>1) await c.query(`UPDATE "Fund" SET "termsVersion"="termsVersion"+1 WHERE id=$1`,[village.draft]);
        await c.query(`INSERT INTO "AuditLog"(id,"fundId","villageId","actorUserId","entityType","entityId","actionType",metadata) VALUES ($1,$2,$3,$4,'FUND',$2,$5::"AuditActionType",$6::jsonb)`,[`${village.draft}-log${version}`,village.draft,v,chief,version===1?"CREATE":"UPDATE",JSON.stringify({event:version===1?"DRAFT_CREATED":"DRAFT_UPDATED",termsVersion:version,villageTargetAmount:1001})]);
      }
    });
    if(profile === "boundary") result.boundaryAuditFund=village.draft;
    result.people+=shape.people;result.households+=shape.houses;result.villages.push(village);
  }
  return result;
}

export interface FinancialTrigger {
  table_name: string; tgname: string; tgenabled: string; tgtype: number;
  tgdeferrable: boolean; tginitdeferred: boolean; tgnargs: number; unconditional: boolean; function_name: string; function_schema: string;
}
// PostgreSQL tgtype: ROW=1, BEFORE=2, INSERT=4, DELETE=8, UPDATE=16, TRUNCATE=32.
// Definitions mirror 20261107120000_fund_financial_integrity/migration.sql.
export const REQUIRED_FINANCIAL_TRIGGERS = (() => {
  const rows: Omit<FinancialTrigger, "tgenabled">[] = [];
  const add = (table: string, name: string, fn: string, type: number, deferred = false) => rows.push({
    table_name: table, tgname: name, function_name: fn, function_schema: "public", tgtype: type,
    tgdeferrable: deferred, tginitdeferred: deferred, tgnargs: 0, unconditional: true,
  });
  add("Village", "vfc_00_bootstrap", "vfc_bootstrap_village_scope", 5);
  for (const table of ["Village", "User", "House", "Fund", "FundHouseAssessment", "Payment", "Receipt", "FundEndDateExtension", "CollectorAssignment", "VillageDeactivationRequest"]) {
    add(table, "vfc_00_scope", "vfc_scope_change", 31);
    add(table, "vfc_10_enqueue", "vfc_scope_change", 29);
  }
  add("Fund", "vfc_fund_guard", "vfc_fund_guard", 31);
  add("Fund", "vfc_transition_check", "vfc_fund_transition_check", 17, true);
  for (const table of ["FundHouseAssessment", "Payment", "Receipt", "FundEndDateExtension"]) add(table, "vfc_record_guard", "vfc_financial_record_guard", 31);
  add("FundEndDateExtension", "vfc_extension_applied", "vfc_extension_applied", 5, true);
  add("FundFinancialValidationWork", "vfc_validate_work", "vfc_validate_work", 5, true);
  add("AuditLog", "vfc_audit_guard", "vfc_financial_audit_guard", 31);
  for (const table of ["Fund", "FundHouseAssessment", "Payment", "Receipt", "FundEndDateExtension", "AuditLog", "VillageFinancialWriteLock", "FundFinancialValidationWork"]) add(table, "vfc_no_truncate", "vfc_no_financial_truncate", 34);
  return rows;
})();
export function requireFinancialGuards(actual: FinancialTrigger[], replicationRole: string): void {
  if (replicationRole !== "origin") throw new Error("Financial fixture requires origin replication role");
  for (const expected of REQUIRED_FINANCIAL_TRIGGERS) {
    const matches = actual.filter((row) => row.table_name === expected.table_name && row.tgname === expected.tgname);
    const row = matches[0];
    if (matches.length !== 1 || !["O", "A"].includes(row.tgenabled) ||
        Object.entries(expected).some(([key, value]) => row[key as keyof FinancialTrigger] !== value)) {
      throw new Error(`Financial fixture protection missing or inconsistent: ${expected.table_name}.${expected.tgname}`);
    }
  }
}

export interface DatasetCardinalities { assessments: number; payments: number; receipts: number; lifecycle: number; audit: number }
/** Exact dependency mapping in reconcileFund/reader, including association completeness. */
export function expectedBoundaryOutcome(counts: DatasetCardinalities) {
  const complete = Object.fromEntries(Object.entries(counts).map(([key, count]) => [key, count <= 10000])) as Record<keyof DatasetCardinalities, boolean>;
  complete.audit = Object.values(complete).every(Boolean);
  const dependencies: Record<keyof DatasetCardinalities, (keyof DatasetCardinalities)[]> = {
    assessments: ["assessments"], payments: ["assessments", "payments"], receipts: ["payments", "receipts"],
    lifecycle: ["assessments", "payments", "lifecycle"], audit: ["assessments", "payments", "receipts", "lifecycle", "audit"],
  };
  const incomplete: string[] = [];
  const checks = Object.fromEntries(Object.entries(dependencies).map(([category, deps]) => {
    const missing = deps.filter((key) => !complete[key]);
    for (const dependency of missing) incomplete.push(`${category}:${dependency}`);
    return [category, missing.length ? "UNVERIFIED" : "PASS"];
  }));
  return { checks, incomplete: incomplete.sort(), metricsAvailable: complete.assessments && complete.payments };
}

/** Append bounded synthetic annotations using the existing guarded audit service. */
export async function recordSyntheticVillageAudit(db: TestDatabase, villageId: string, actorUserId: string, fixtureRun: string): Promise<string[]> {
  return db.prisma.$transaction(async (tx) => {
    const ids: string[] = [];
    for (let annotation = 0; annotation < 25; annotation++) {
      const log = await createAuditLog(tx, {
        actionType: annotation === 0 ? AuditActionType.CREATE : AuditActionType.UPDATE,
        entityType: AuditEntityType.VILLAGE, entityId: villageId, villageId, actorUserId,
        metadata: { event: annotation === 0 ? "SYNTHETIC_VILLAGE_CREATED" : "SYNTHETIC_BENCHMARK_ANNOTATION", fixtureRun, annotation },
      });
      ids.push(log.id);
    }
    return ids;
  });
}
