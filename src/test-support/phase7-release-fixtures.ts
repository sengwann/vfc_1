/** Small correctness fixtures, not a performance profile or writer test.
 * Normal guarded SQL, committed before readers. Only owned release children.
 * No cleanup DML: dispose the branch. No historical corruption is manufactured.
 */
import { parseFinancialDateRange } from "@/lib/financial-date-range";
import { randomUUID } from "node:crypto";
import type { TestDatabase } from "./test-database";
import { getCurrentPeriod } from "@/lib/authz/collector-period";
export async function buildReleaseFixture(db: TestDatabase) {
  const run = `release-${randomUUID()}`;
  const villages: { id: string; chief: string; collector: string; payer: string; former: string; active: string; closed: string; draft: string; other: string; boundary: string; newcomer: string }[] = [];
  const day="2026-01-02",range=parseFinancialDateRange(day,day);
  if(!range.ok||!range.gte||!range.lt)throw new Error("Boundary fixture date invalid");
  const instants=[new Date(range.gte.getTime()-1),range.gte,new Date(range.lt.getTime()-1),range.lt];
  for (let index = 0; index < 2; index++) {
    const id = `${run}-v${index}`, chief = `${id}-u0`, collector = `${id}-u1`;
    const c = await db.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`INSERT INTO "Village"(id,"villageCode",name,"updatedAt") VALUES ($1,$1,$1,now())`, [id]);
      await c.query(`INSERT INTO "House"(id,"villageId","houseNumber","updatedAt") SELECT $1||'-h'||i,$1,'Frozen '||i,now() FROM generate_series(0,53) i`, [id]);
      await c.query(`INSERT INTO "User"(id,"villageId","houseId",role,"membershipStatus",name,"passwordHash","updatedAt") SELECT $1||'-u'||i,$1,$1||'-h'||i,CASE WHEN i=0 THEN 'CHIEF'::"UserRole" ELSE 'VILLAGER'::"UserRole" END,'ACTIVE','Synthetic '||i,'not-a-login-password',now() FROM generate_series(0,53) i`, [id]);
      await c.query(`INSERT INTO "User"(id,"villageId","houseId",role,"membershipStatus",name,"passwordHash","updatedAt") VALUES ($1||'-u54',$1,$1||'-h2','VILLAGER','ACTIVE','Non-head member','not-a-login-password',now())`,[id]);
      await c.query(`INSERT INTO "User"(id,"villageId","houseId",role,"membershipStatus",name,"passwordHash","updatedAt") VALUES ($1||'-u55',$1,$1||'-h3','VILLAGER','ACTIVE','Other payer','not-a-login-password',now())`,[id]);
      await c.query(`UPDATE "House" SET "headOfHouseId"=$1||'-u'||substring(id from '-h([0-9]+)$') WHERE "villageId"=$1`, [id]);
      const period = getCurrentPeriod();
      await c.query(`INSERT INTO "CollectorAssignment"(id,"villageId","userId",year,month,"updatedAt") VALUES ($1,$2,$3,$4,$5,now())`, [`${id}-collector`, id, collector, period.year, period.month]);
      await c.query(`INSERT INTO "CollectorAssignment"(id,"villageId","userId",year,month,"isActive","updatedAt") VALUES ($1,$2,$3,$4,$5,false,now())`, [`${id}-former`, id, `${id}-u3`, period.year, period.month]);
      for (const kind of ["other","boundary","closed","active"]) {
        const closed=kind!=="active",fund=`${id}-${kind}`;
        const audit = async (event: string, entity: string, entityId: string, action: string, data: Record<string, unknown>, actor = chief) => {
          await c.query(`INSERT INTO "AuditLog"(id,"villageId","fundId","actorUserId","entityType","entityId","actionType",metadata) VALUES ($1,$2,$3,$4,$5,$6,$7::"AuditActionType",$8::jsonb)`, [randomUUID(), id, fund, actor, entity, entityId, action, JSON.stringify({ event, ...data })]);
        };
        await c.query(`INSERT INTO "Fund"(id,"villageId",name,"villageTargetAmount","startDate","endDate","updatedAt") VALUES ($1,$2,$1,54001,current_date-10,CASE WHEN $3 THEN current_date+1 ELSE current_date-1 END,now())`, [fund,id,closed]);
        await audit("DRAFT_CREATED","FUND",fund,"CREATE",{termsVersion:1,villageTargetAmount:54001});
        await c.query(`INSERT INTO "FundHouseAssessment"(id,"fundId","villageId","houseId","assessmentAmount","houseNumberSnapshot") SELECT $1||'-a'||i,$1,$2,$2||'-h'||i,1001,'Frozen '||i FROM generate_series(0,53) i`, [fund,id]);
        const activated = await c.query<{ snapshotAt: Date }>(`UPDATE "Fund" SET status='ACTIVE',"termsVersion"=2,"eligibleHouseCount"=54,"assessmentPerHouse"=1001,"snapshotAt"=now() WHERE id=$1 RETURNING "snapshotAt"`, [fund]);
        await audit("FUND_ACTIVATED","FUND",fund,"STATUS_CHANGE",{termsVersion:2,villageTargetAmount:54001,eligibleHouseCount:54,assessmentPerHouse:1001,totalAssessment:54054,roundingSurplus:53,snapshotAt:activated.rows[0].snapshotAt.toISOString()});
        if (!closed) {
          const extension = `${fund}-extension`;
          const dates = await c.query<{ previousEndDate: Date; newEndDate: Date }>(`INSERT INTO "FundEndDateExtension"(id,"fundId","villageId","previousEndDate","newEndDate","previousTermsVersion","newTermsVersion","changedByUserId",reason) SELECT $2,id,"villageId","endDate",current_date+1,2,3,$3,'Release fixture extension' FROM "Fund" WHERE id=$1 RETURNING "previousEndDate","newEndDate"`, [fund,extension,chief]);
          await c.query(`UPDATE "Fund" SET "endDate"=current_date+1,"termsVersion"=3 WHERE id=$1`, [fund]);
          await audit("FUND_EXTENDED","FUND_END_DATE_EXTENSION",extension,"UPDATE",{extensionId:extension,previousEndDate:dates.rows[0].previousEndDate.toISOString().slice(0,10),newEndDate:dates.rows[0].newEndDate.toISOString().slice(0,10),termsVersion:3,reason:"Release fixture extension"});
        }
        for (let h=0; h<(closed?54:26); h++) {
          // Same payment instant for deterministic tie traversal. Receipt issue
          // time differs by a day; history must filter by Payment.createdAt.
          const p = `${fund}-p${h}`, receipt = `${p}-r`;
          const data = { paymentId:p,houseId:`${id}-h${h}`,assessmentId:`${fund}-a${h}`,amount:1001 };
          const payer=kind==="other"&&h===2?`${id}-u54`:kind==="other"&&h===3?`${id}-u55`:`${id}-u${h}`;
          const paymentTime=kind==="boundary"?(instants[h]??instants[0]).toISOString():null;
          const receiptTime=kind==="boundary"?(h===1||h===2?new Date(range.lt!.getTime()+86400000):range.gte!).toISOString():null;
          await c.query(`INSERT INTO "Payment"(id,"fundId","villageId","houseId","fundHouseAssessmentId","payerUserId","collectorUserId",amount,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,1001,COALESCE($8::timestamp,date_trunc('day',now())-interval '1 day'),now())`,[p,fund,id,data.houseId,data.assessmentId,payer,collector,paymentTime]);
          await c.query(`INSERT INTO "Receipt"(id,"receiptNumber","paymentId","villageId","createdAt","updatedAt") VALUES ($1,$1,$2,$3,COALESCE($4::timestamp,now()),now())`,[receipt,p,id,receiptTime]);
          await audit("PAYMENT_CREATED","PAYMENT",p,"CREATE",data,collector);
          await audit("RECEIPT_CREATED","RECEIPT",receipt,"CREATE",{paymentId:p,receiptId:receipt,receiptNumber:receipt},collector);
        }
        if (closed) {
          const closure = await c.query<{closedAt:Date}>(`UPDATE "Fund" SET status='CLOSED',"termsVersion"=3,"closedAt"=now(),"closedByUserId"=$2 WHERE id=$1 RETURNING "closedAt"`,[fund,chief]);
          await audit("FUND_CLOSED","FUND",fund,"STATUS_CHANGE",{termsVersion:3,closedAt:closure.rows[0].closedAt.toISOString(),acceptedPaymentCount:54});
        }
      }
      const draft = `${id}-draft`;
      await c.query(`INSERT INTO "Fund"(id,"villageId",name,"villageTargetAmount","startDate","endDate","updatedAt") VALUES ($1,$2,$1,1001,current_date,current_date+1,now())`,[draft,id]);
      await c.query(`INSERT INTO "AuditLog"(id,"villageId","fundId","actorUserId","entityType","entityId","actionType",metadata) VALUES ($1,$2,$3,$4,'FUND',$3,'CREATE',$5::jsonb)`,[randomUUID(),id,draft,chief,JSON.stringify({event:"DRAFT_CREATED",termsVersion:1,villageTargetAmount:1001})]);
      // Flush activation/closure deferred checks before a new eligible house
      // exists. It is genuinely added after the frozen snapshot committed.
      await c.query("COMMIT");
      await c.query("BEGIN");
      const newcomer = `${id}-new`;
      await c.query(`INSERT INTO "House"(id,"villageId","houseNumber","updatedAt") VALUES ($1,$2,'New household',now())`,[newcomer,id]);
      await c.query(`INSERT INTO "User"(id,"villageId","houseId",role,"membershipStatus",name,"passwordHash","updatedAt") VALUES ($1,$2,$1,'VILLAGER','ACTIVE','New member','not-a-login-password',now())`,[newcomer,id]);
      await c.query(`UPDATE "House" SET "headOfHouseId"=$1 WHERE id=$1`,[newcomer]);
      await c.query("COMMIT");
      villages.push({id,chief,collector,payer:`${id}-u2`,former:`${id}-u3`,active:`${id}-active`,closed:`${id}-closed`,other:`${id}-other`,boundary:`${id}-boundary`,draft,newcomer});
    } catch (error) { try { await c.query("ROLLBACK"); } catch (rollback) { throw new AggregateError([error,rollback],"Fixture rollback failed"); } throw error; }
    finally { c.release(); }
  }
  return { run, villages, day, instants };
}
