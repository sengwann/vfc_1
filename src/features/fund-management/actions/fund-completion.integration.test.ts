/** Opt-in only. Real actions/authority/audit/constraints. Session claims, preflight,
 * navigation and Prisma routing are controlled boundaries. No tests executed here. */
import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { describe, expect, it, vi } from "vitest";
import { disposable, migration } from "../lib/fund-migration-test-support";
import { activate, pay } from "../lib/fund-schema-test-support";
import { inspectDatabaseError } from "@/lib/db/database-errors";
const b = vi.hoisted(() => ({ client: null as PrismaClient | null, auditFailure: false, precedingWrite: false }));
vi.mock("@/lib/authz", () => ({ requireChief: async () => ({ villageId: "v" }) }));
vi.mock("@/lib/auth/session-identity", () => ({ getSessionIdentity: async () => ({ userId: "v", sessionVersion: 0 }) }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw Object.assign(new Error("navigation"), { path }); } }));
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get(_target, key) {
  const client = b.client!;
  if (key === "$transaction") return (body: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => client.$transaction(async (tx) => {
    const proxy = new Proxy(tx, { get(target, method) {
      if (method === "auditLog" && b.auditFailure) return new Proxy(target.auditLog, { get(delegate, field) {
        if (field === "create") return async (args: Prisma.AuditLogCreateArgs) => {
          const fund = await target.fund.findUniqueOrThrow({ where: { id: "v" } });
          b.precedingWrite = fund.termsVersion === 3 && (fund.status === "CLOSED" || await target.fundEndDateExtension.count() === 1);
          return delegate.create({ ...args, data: { ...(args.data as Prisma.AuditLogUncheckedCreateInput), actorUserId: "missing-audit-actor" } });
        };
        const value = Reflect.get(delegate, field); return typeof value === "function" ? value.bind(delegate) : value;
      } });
      const value = Reflect.get(target, method); return typeof value === "function" ? value.bind(target) : value;
    } });
    return body(proxy);
  }, options);
  const value = Reflect.get(client, key); return typeof value === "function" ? value.bind(client) : value;
} }) }));
import { extendFundAction } from "./extend-fund.action";
import { closeFundAction } from "./close-fund.action";
const enabled = Boolean(process.env.TEST_DATABASE_URL) && process.env.VFC_ALLOW_MIGRATION_TESTS === "1";
function form(newEndDate: string, version = "2") { const f = new FormData(); for (const [k,v] of Object.entries({ fundId: "v", termsVersion: version, newEndDate, reason: "Unpaid houses" })) f.set(k,v); return f; }
async function fixture(offset: number, paid: boolean, run: (p: PrismaClient, raw: import("pg").Client, next: string) => Promise<void>, twoHouses = false) {
  await disposable(async (raw, url) => {
    await raw.query(await migration());
    await raw.query(`INSERT INTO "Village"(id,"villageCode",name,"updatedAt") VALUES ('v','v','Test',now());
      INSERT INTO "House"(id,"villageId","houseNumber","updatedAt") VALUES ('v','v','H1',now());
      INSERT INTO "User"(id,"villageId","houseId",role,"membershipStatus",name,"passwordHash","updatedAt") VALUES ('v','v','v','CHIEF','ACTIVE','Chief','unused',now());
      UPDATE "House" SET "headOfHouseId"='v' WHERE id='v'`);
    await raw.query(`INSERT INTO "Fund"(id,"villageId",name,"villageTargetAmount","startDate","endDate","updatedAt") VALUES ('v','v','Fund',1001,(clock_timestamp() AT TIME ZONE 'Asia/Yangon')::date-3,(clock_timestamp() AT TIME ZONE 'Asia/Yangon')::date+$1::int,now())`, [offset]);
    await raw.query('BEGIN');
    if (twoHouses) {
      await raw.query(`INSERT INTO "House"(id,"villageId","houseNumber","updatedAt") VALUES ('second','v','H2',now());
        INSERT INTO "User"(id,"villageId","houseId",role,"membershipStatus",name,"passwordHash","updatedAt") VALUES ('second','v','second','VILLAGER','ACTIVE','Head','unused',now());
        UPDATE "House" SET "headOfHouseId"='second' WHERE id='second';
        INSERT INTO "FundHouseAssessment"(id,"fundId","houseId","villageId","assessmentAmount","houseNumberSnapshot") VALUES ('v','v','v','v',501,'H1'),('second','v','second','v',501,'H2');
        UPDATE "Fund" SET status='ACTIVE',"eligibleHouseCount"=2,"assessmentPerHouse"=501,"snapshotAt"=now(),"termsVersion"=2 WHERE id='v'`);
    } else await activate(raw,'v');
    if (paid) await pay(raw,'v',twoHouses?10000000:1001); await raw.query('COMMIT');
    const next = (await raw.query(`SELECT ((clock_timestamp() AT TIME ZONE 'Asia/Yangon')::date+2)::text AS day`)).rows[0].day;
    const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    b.client=p; b.auditFailure=false; b.precedingWrite=false;
    let failure = false;
    try { await run(p,raw,next); } catch (error) { failure=true; throw error; }
    finally { b.client=null; try { await p.$disconnect(); } catch(error) { if (!failure) throw error; console.error(error); } }
  });
}
describe.skipIf(!enabled)("Phase 6 real lifecycle transactions", () => {
  it.each([0,1])("closes a fully paid Fund with end date today+%i and preserves history", async (offset) => {
    await fixture(offset,true,async(p,_raw,next) => {
      const old = { assessments: await p.fundHouseAssessment.findMany(), payments: await p.payment.findMany(), receipts: await p.receipt.findMany() };
      await expect(closeFundAction(form(next))).rejects.toMatchObject({ path: "/village/funds/v" });
      const f = await p.fund.findUniqueOrThrow({ where: { id:"v" } });
      expect(f).toMatchObject({ status:"CLOSED", termsVersion:3, closedByUserId:"v", closedAt:expect.any(Date) });
      expect(await p.fundHouseAssessment.findMany()).toEqual(old.assessments); expect(await p.payment.findMany()).toEqual(old.payments); expect(await p.receipt.findMany()).toEqual(old.receipts);
      expect(await p.auditLog.findFirst()).toMatchObject({ fundId:"v", villageId:"v", actorUserId:"v", entityId:"v", actionType:"STATUS_CHANGE", metadata:{event:"FUND_CLOSED",closedAt:f.closedAt!.toISOString(),termsVersion:3,acceptedPaymentCount:1} });
    });
  },60000);
  it("extends expired unpaid Fund, preserves snapshot and rejects stale version", async () => {
    await fixture(-1,false,async(p,_raw,next) => {
      const old = await p.fund.findUniqueOrThrow({ where:{id:"v"} }); const snapshot = await p.fundHouseAssessment.findMany();
      // An eligible new House must not enter either coverage or the snapshot.
      await p.$transaction(async(tx) => { await tx.house.create({data:{id:"new",villageId:"v",houseNumber:"H2"}}); await tx.user.create({data:{id:"new",villageId:"v",houseId:"new",name:"New",passwordHash:"unused",membershipStatus:"ACTIVE"}}); await tx.house.update({where:{id:"new"},data:{headOfHouseId:"new"}}); });
      expect(await extendFundAction(form(next))).toEqual({success:true});
      const e = (await p.fundEndDateExtension.findFirst())!;
      expect(e).toMatchObject({previousEndDate:old.endDate,newEndDate:new Date(next),previousTermsVersion:2,newTermsVersion:3,changedByUserId:"v",changedAt:expect.any(Date),reason:"Unpaid houses"});
      expect(await p.fundHouseAssessment.findMany()).toEqual(snapshot);
      expect(await p.auditLog.findFirst()).toMatchObject({fundId:"v",villageId:"v",actorUserId:"v",entityId:e.id,metadata:{event:"FUND_EXTENDED",extensionId:e.id,previousEndDate:old.endDate.toISOString().slice(0,10),newEndDate:next,reason:e.reason,termsVersion:3}});
      expect(await extendFundAction(form(next))).toMatchObject({success:false,formError:"Fund details have changed. Reload the form."});
      expect(await p.fundEndDateExtension.count()).toBe(1);
    });
  },60000);
  it.each(["close","extend"] as const)("rolls back %s after precise audit FK failure",async(operation) => {
    await fixture(operation==="extend"?-1:1,operation==="close",async(p,_raw,next) => {
      const before = await p.fund.findUnique({where:{id:"v"}}); b.auditFailure=true;
      let failure: unknown;
      try { if(operation==="extend") await extendFundAction(form(next)); else await closeFundAction(form(next)); } catch(error) {failure=error;}
      expect(b.precedingWrite).toBe(true);
      const d=inspectDatabaseError(failure); expect(d.retryable).toBe(false);
      expect(d.prismaCodes.includes("P2003")||d.sqlStates.includes("23503")).toBe(true);
      // Adapter diagnostics are structured; the failure must identify the AuditLog actor FK.
      const pending:unknown[]=[failure]; const seen=new Set<object>(); let actor=false;
      while(pending.length && seen.size<32){const n=pending.shift();if(!n||typeof n!=="object"||seen.has(n))continue;seen.add(n);const v=n as Record<string,unknown>;
        if(v.constraint==="AuditLog_actorUserId_fkey"||v.field_name==="AuditLog_actorUserId_fkey")actor=true;
        const c=v.constraint as {fields?:unknown}|undefined; if(c && JSON.stringify(c.fields)==='["actorUserId"]')actor=true;
        pending.push(v.cause,v.originalError,v.meta,(v.meta as Record<string,unknown>|undefined)?.driverAdapterError);}
      expect(actor).toBe(true);
      expect(await p.fund.findUnique({where:{id:"v"}})).toEqual(before); expect(await p.fundEndDateExtension.count()).toBe(0); expect(await p.auditLog.count()).toBe(0);
    });
  },60000);
  it("rejects closure despite target attainment when another frozen assessment is unpaid",async()=>{
    await fixture(1,true,async(p,_raw,next)=>{
      expect((await p.payment.aggregate({_sum:{amount:true}}))._sum.amount).toBe(10000000);
      await expect(closeFundAction(form(next))).rejects.toMatchObject({path:expect.stringContaining("lifecycleError=")});
      expect(await p.fund.findUnique({where:{id:"v"}})).toMatchObject({status:"ACTIVE",termsVersion:2});expect(await p.auditLog.count()).toBe(0);
    },true);
  },60000);
  it.each(["role","membership","password","session"] as const)("rechecks current %s for extension",async(change)=>{
    await fixture(-1,false,async(p,_raw,next)=>{
      if(change==="membership") await p.$transaction(async(tx)=>{
        await tx.user.create({data:{id:"remaining-head",villageId:"v",houseId:"v",name:"Head",passwordHash:"unused",membershipStatus:"ACTIVE"}});
        await tx.house.update({where:{id:"v"},data:{headOfHouseId:"remaining-head"}});
      });
      await p.user.update({where:{id:"v"},data:change==="role"?{role:"VILLAGER"}:change==="membership"?{membershipStatus:"REMOVED"}:change==="password"?{mustChangePassword:true}:{sessionVersion:1}});
      await expect(extendFundAction(form(next))).rejects.toMatchObject({path:change==="password"?"/change-password":change==="session"?"/login":"/forbidden"});
      expect(await p.fundEndDateExtension.count()).toBe(0);expect(await p.auditLog.count()).toBe(0);
    });
  },60000);
  it("rejects a foreign-Village target inside the actual transaction",async()=>{
    await fixture(-1,false,async(p,_raw,next)=>{
      await p.village.create({data:{id:"foreign",villageCode:"foreign",name:"Foreign"}});
      await p.fund.create({data:{id:"foreign",villageId:"foreign",name:"Foreign",villageTargetAmount:1001,startDate:new Date("2026-01-01"),endDate:new Date("2026-12-31")}});
      const f=form(next);f.set("fundId","foreign");expect(await extendFundAction(f)).toEqual({success:false,formError:"Fund not found."});
      expect(await p.fundEndDateExtension.count()).toBe(0);expect(await p.auditLog.count()).toBe(0);
    });
  },60000);
  it("uses Yangon boundaries regardless of session zone",async()=>{
    await fixture(-1,false,async(_p,raw)=>{
      for(const zone of ["UTC","America/New_York","Asia/Yangon"]){await raw.query("SELECT set_config('TimeZone',$1,false)",[zone]);
        expect((await raw.query(`SELECT vfc_fund_expired('2026-12-31','2026-12-31T17:29:59.999999Z') AS before, vfc_fund_expired('2026-12-31','2026-12-31T17:30:00Z') AS after`)).rows[0]).toEqual({before:false,after:true});}
    });
  },60000);
});
