/** Test-only raw SQL fixtures. Every case rolls back, including CLOSED records. */
import { randomUUID } from "node:crypto";
import type { PoolClient, Client } from "pg";
import { withReleaseDatabase } from "@/test-support/phase7-release-sandbox";

export async function fixture(run: (db: PoolClient | Client, id: string) => Promise<void>) {
  return withReleaseDatabase("migrated", async (db) => {
    const id = randomUUID();
    const failures:unknown[]=[];
    try {
      await db.query("BEGIN");
      await db.query('INSERT INTO "Village"(id,"villageCode",name,"updatedAt") VALUES ($1,$1,\'Test\',now())', [id]);
      await db.query('INSERT INTO "House"(id,"villageId","houseNumber","updatedAt") VALUES ($1,$1,\'H1\',now())', [id]);
      await db.query(`INSERT INTO "User"(id,"villageId","houseId",role,"membershipStatus",name,"passwordHash","updatedAt")
        VALUES ($1,$1,$1,'CHIEF','ACTIVE','Test','unused',now())`, [id]);
      await db.query('UPDATE "House" SET "headOfHouseId"=$1 WHERE id=$1', [id]);
      await db.query(`INSERT INTO "Fund"(id,"villageId",name,"villageTargetAmount","startDate","endDate","updatedAt")
        VALUES ($1,$1,'Test',1001,(clock_timestamp() AT TIME ZONE 'Asia/Yangon')::date-1,
        (clock_timestamp() AT TIME ZONE 'Asia/Yangon')::date+1,now())`, [id]);
      await run(db, id);
    } catch(error) { failures.push(error); } finally {
      try{await db.query("ROLLBACK");}catch(error){failures.push(error);}
    }
    if(failures.length)throw new AggregateError(failures,"Schema fixture or rollback failed");
  });
}
export async function activate(db: PoolClient | Client, id: string, assessment = 1001) {
  await db.query(`INSERT INTO "FundHouseAssessment"(id,"fundId","houseId","villageId","assessmentAmount","houseNumberSnapshot")
    VALUES ($1,$1,$1,$1,$2,'H1')`, [id, assessment]);
  await db.query(`UPDATE "Fund" SET status='ACTIVE',"eligibleHouseCount"=1,"assessmentPerHouse"=$2,
    "snapshotAt"=now(),"termsVersion"=2 WHERE id=$1`, [id, assessment]);
}
export async function pay(db: PoolClient | Client, id: string, amount = 1001, suffix = "") {
  const payment = id + suffix;
  await db.query(`INSERT INTO "Payment"(id,"villageId","fundId","houseId","fundHouseAssessmentId","payerUserId","collectorUserId",amount,"updatedAt")
    VALUES ($1,$2,$2,$2,$2,$2,$2,$3,now())`, [payment, id, amount]);
  await db.query(`INSERT INTO "Receipt"(id,"receiptNumber","paymentId","villageId","updatedAt") VALUES ($1,$1,$1,$2,now())`, [payment, id]);
}
export async function check(db: PoolClient | Client) {
  await db.query("SET CONSTRAINTS ALL IMMEDIATE");
  await db.query("SET CONSTRAINTS ALL DEFERRED");
}
