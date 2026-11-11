/** Real lifecycle/payment/Village operations, independent clients and explicit
 * barriers. Only signed claims, preflight, navigation and connection routing are mocked. */
import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TranslationProvider } from "@/lib/i18n/provider";
import { en } from "@/lib/i18n/en";
import { my } from "@/lib/i18n/my";
import { FundCompletionError } from "../components/extend-fund-form";
import { FundLifecycleActions } from "../components/fund-lifecycle-actions";
import { describe, expect, it, vi } from "vitest";
import { disposable, migration } from "../lib/fund-migration-test-support";
import { activate, pay } from "../lib/fund-schema-test-support";
import { getCurrentPeriod } from "@/lib/authz/collector-period";
type Context = { client: PrismaClient; actor?: string; before?: (tx: Prisma.TransactionClient) => Promise<void>; after?: () => Promise<void>; onError?: (error: unknown) => Promise<void>; transactions?: Prisma.TransactionClient[]; attempts: number };
const b = await vi.hoisted(async () => { const { AsyncLocalStorage } = await import("node:async_hooks"); return { request: new AsyncLocalStorage<Context>() }; });
function context() { const c=b.request.getStore(); if(!c) throw new Error("No request context"); return c; }
vi.mock("@/lib/authz", () => ({ requireChief:async()=>({villageId:"v"}),requireActiveCollector:async()=>({villageId:"v"}) }));
vi.mock("@/lib/auth/session-identity", () => ({ getSessionIdentity:async()=>({userId:context().actor??"v",sessionVersion:0}) }));
vi.mock("next/navigation", () => ({ useRouter:()=>({refresh:vi.fn()}), redirect:(path:string)=>{throw Object.assign(new Error("navigation"),{path});} }));
vi.mock("@/lib/prisma", () => ({ prisma:new Proxy({}, {get(_target,key){
  const c=context(), client=c.client;
  if(key==="$transaction") return (body:(tx:Prisma.TransactionClient)=>Promise<unknown>,options:object)=>client.$transaction(async(tx)=>{
    c.attempts++; c.transactions?.push(tx); await c.before?.(tx);
    let result: unknown;
    try { result = await body(tx); }
    catch (error) { await c.onError?.(error); throw error; }
    await c.after?.(); return result;
  },{...options,timeout:20000});
  const value=Reflect.get(client,key);return typeof value==="function"?value.bind(client):value;
}}) }));
import { extendFundAction } from "./extend-fund.action";
import { closeFundAction } from "./close-fund.action";
import { recordCashPaymentAction } from "@/features/cash-payment/actions/record-cash-payment.action";
import { voidPaymentAction } from "@/features/cash-payment/actions/void-payment.action";
import { FundWriteError } from "../lib/fund-write";
import { inspectDatabaseError } from "@/lib/db/database-errors";
import { changeVillageStatus } from "@/features/village-management/lib/change-village-status";
const enabled=Boolean(process.env.TEST_DATABASE_URL)&&process.env.VFC_ALLOW_MIGRATION_TESTS==="1";
function gate(){let open!:()=>void;const reached=new Promise<void>(resolve=>{open=resolve;});return{open,reached};}
function observe<T>(p:Promise<T>){return p.then(value=>({value}), (error:unknown)=>({error}));}
async function reach<T>(g:ReturnType<typeof gate>,p:ReturnType<typeof observe<T>>){await Promise.race([g.reached,p.then(out=>{if("error"in out)throw out.error;throw new Error("Operation completed before barrier");})]);}
const unpaidClosure = "Every assessed house must have an accepted payment before closure.";
const staleTerms = "Fund details have changed. Reload the form.";
function expectClosure(outcome: unknown, failure?: string) {
  expect(outcome).toMatchObject({ error: { path: expect.any(String) } });
  const path = (outcome as { error: { path: string } }).error.path;
  const url = new URL(path, "https://vfc.test");
  expect(url.pathname).toBe("/village/funds/v");
  expect(url.searchParams.get("lifecycleError")).toBe(failure ?? null);
  if (!failure) expect(url.search).toBe("");
}
function expectScopeBusy(error: unknown) {
  expect(inspectDatabaseError(error).sqlStates).toContain("40001");
  const pending: unknown[] = [error], seen = new Set<object>();
  let identified = false;
  while (pending.length && seen.size < 32) {
    const value = pending.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    const node = value as Record<string, unknown>;
    if (node.message === "VFC_SCOPE_BUSY_RETRY_TRANSACTION" || node.originalMessage === "VFC_SCOPE_BUSY_RETRY_TRANSACTION") identified = true;
    pending.push(node.cause, node.originalError, node.meta, (node.meta as Record<string, unknown> | undefined)?.driverAdapterError);
  }
  expect(identified).toBe(true);
}
function form(next:string){const f=new FormData();for(const[k,v]of Object.entries({fundId:"v",termsVersion:"2",newEndDate:next,reason:"Unpaid houses",houseId:"v",payerUserId:"v",amount:"1001",paymentId:"v",voidReason:"Incorrect payer recorded"}))f.set(k,v);return f;}
type Operation="extend"|"close"|"pay"|"void"|"suspend";
function operation(kind:Operation,next:string){if(kind==="extend")return extendFundAction(form(next));if(kind==="close")return closeFundAction(form(next));if(kind==="pay")return recordCashPaymentAction(form(next));if(kind==="void")return voidPaymentAction(form(next));return changeVillageStatus({villageId:"v",action:"suspend",actorUserId:"admin",reason:"Test suspension"});}
async function fixture(expired:boolean,paid:boolean,run:(p:PrismaClient,other:PrismaClient,raw:import("pg").Client,next:string)=>Promise<void>){
  await disposable(async(raw,url)=>{
    await raw.query(await migration());
    await raw.query(`INSERT INTO "Village"(id,"villageCode",name,"updatedAt") VALUES ('v','v','Test',now());
      INSERT INTO "House"(id,"villageId","houseNumber","updatedAt") VALUES ('v','v','H1',now());
      INSERT INTO "User"(id,"villageId","houseId",role,"membershipStatus",name,"passwordHash","updatedAt") VALUES ('v','v','v','CHIEF','ACTIVE','Chief','unused',now()),('admin',NULL,NULL,'SYSTEM_ADMIN',NULL,'Admin','unused',now());
      UPDATE "House" SET "headOfHouseId"='v' WHERE id='v'`);
    const period=getCurrentPeriod();
    await raw.query(`INSERT INTO "CollectorAssignment"(id,"villageId","userId",year,month,"updatedAt") VALUES ('assignment','v','v',$1,$2,now())`,[period.year,period.month]);
    await raw.query(`INSERT INTO "Fund"(id,"villageId",name,"villageTargetAmount","startDate","endDate","updatedAt") VALUES ('v','v','Fund',1001,(clock_timestamp() AT TIME ZONE 'Asia/Yangon')::date-3,(clock_timestamp() AT TIME ZONE 'Asia/Yangon')::date+$1::int,now())`,[expired?-1:1]);
    await raw.query("BEGIN");await activate(raw,"v");if(paid)await pay(raw,"v");await raw.query("COMMIT");
    const next=(await raw.query(`SELECT ((clock_timestamp() AT TIME ZONE 'Asia/Yangon')::date+2)::text AS day`)).rows[0].day;
    const clients=[new PrismaClient({adapter:new PrismaPg({connectionString:url})}),new PrismaClient({adapter:new PrismaPg({connectionString:url})})];let failed=false;
    try{await run(clients[0],clients[1],raw,next);}catch(error){failed=true;throw error;}
    finally{await raw.query("ROLLBACK").catch(error=>console.error(error));const results=await Promise.allSettled(clients.map(c=>c.$disconnect()));for(const out of results)if(out.status==="rejected"){if(!failed)throw out.reason;console.error(out.reason);}}
  });
}
const races: { first:Operation; second:Operation; paid:boolean; expired:boolean; closed:boolean; replacement?:boolean }[]=[
  {first:"extend",second:"extend",paid:false,expired:true,closed:false},
  {first:"extend",second:"close",paid:false,expired:true,closed:false},
  {first:"close",second:"extend",paid:true,expired:false,closed:true},
  {first:"pay",second:"close",paid:false,expired:false,closed:true},
  {first:"close",second:"pay",paid:false,expired:false,closed:false},
  {first:"void",second:"close",paid:true,expired:false,closed:false},
  {first:"close",second:"void",paid:true,expired:false,closed:true},
  {first:"close",second:"suspend",paid:true,expired:false,closed:true},
  {first:"pay",second:"close",paid:true,expired:false,closed:true,replacement:true},
  {first:"close",second:"pay",paid:true,expired:false,closed:false,replacement:true},
];
describe.skipIf(!enabled)("Phase 6 coordinated real-operation races",()=>{
  it.each(races)("$first before $second",async({first:kind,second:nextKind,paid,expired,closed,replacement})=>{
    await fixture(expired,paid,async(p,other,raw,next)=>{
      if(replacement) expect(await b.request.run({client:p,attempts:0},()=>operation("void",next))).toEqual({success:true});
      const held=gate(),release=gate(),snapshot=gate(),committed=gate(),busy=gate(),retry=gate();
      const rejectedFirst = kind === "close" && !closed;
      const revisionBefore = (await raw.query(`SELECT revision FROM "VillageFinancialWriteLock" WHERE "villageId"='v'`)).rows[0].revision;
      const hold = async () => { held.open(); await release.reached; };
      const firstContext:Context={client:p,attempts:0,
        after: rejectedFirst ? undefined : hold,
        onError: rejectedFirst ? async(error) => {
          expect(error).toBeInstanceOf(FundWriteError);
          expect((error as Error).message).toBe(unpaidClosure);
          // The real guard has thrown; keep its transaction/scope alive until released.
          await hold();
        } : undefined,
      };
      const secondContext:Context={client:other,attempts:0,transactions:[],onError: rejectedFirst ? async(error) => { expectScopeBusy(error); busy.open(); await retry.reached; } : undefined,actor:nextKind==="suspend"?"admin":"v",before:async(tx)=>{
        if(!rejectedFirst && secondContext.attempts===1){await tx.$queryRaw`SELECT id FROM "Village" WHERE id='v'`;snapshot.open();await committed.reached;}
      }};
      const first=observe<unknown>(b.request.run(firstContext,()=>operation(kind,next)));let second:ReturnType<typeof observe<unknown>>|undefined;
      try{
        await reach(held,first);
        await raw.query("BEGIN");await expect(raw.query(`SELECT vfc_acquire_villages(ARRAY['v'])`)).rejects.toMatchObject({code:"40001",message:"VFC_SCOPE_BUSY_RETRY_TRANSACTION"});await raw.query("ROLLBACK");
        second=observe<unknown>(b.request.run(secondContext,()=>operation(nextKind,next)));
        await reach(rejectedFirst ? busy : snapshot,second);
        release.open();const a=await first;
        if (rejectedFirst) {
          expectClosure(a, unpaidClosure);
          expect((await raw.query(`SELECT revision FROM "VillageFinancialWriteLock" WHERE "villageId"='v'`)).rows[0].revision).toBe(revisionBefore);
          // The scope revision and all lifecycle/audit changes rolled back.
          expect(await p.fund.findUnique({where:{id:"v"}})).toMatchObject({status:"ACTIVE",termsVersion:2,closedAt:null,closedByUserId:null});
          expect(await p.auditLog.count({where:{metadata:{path:["event"],equals:"FUND_CLOSED"}}})).toBe(0);
        }
        committed.open();retry.open();const z=await second;
        // Only committed scope changes establish a stale-snapshot conflict.
        if (!rejectedFirst) expect(secondContext.attempts).toBe(2);
        else expect(secondContext.attempts).toBeGreaterThan(1); // confirmed NOWAIT abort, not a rolled-back revision
        expect(new Set(secondContext.transactions).size).toBe(secondContext.attempts);
        if(kind==="close")expectClosure(a,closed ? undefined : unpaidClosure);
        else expect(a).toEqual({value:{success:true}});
        if(nextKind==="close")expectClosure(z,closed ? undefined : kind === "extend" ? staleTerms : unpaidClosure);
        if(nextKind==="extend")expect(z).toMatchObject({value:{success:false,formError:kind==="extend"?"Fund details have changed. Reload the form.":"Only active funds can be extended or closed."}});
        if(nextKind==="pay")expect(z).toEqual({value:{success:true}});
        if(nextKind==="void")expect(z).toMatchObject({value:{success:false,error:"This fund is no longer active."}});
        if(nextKind==="suspend") {
          expect(z).toEqual({value:"ok"});
          expect(await p.village.findUnique({where:{id:"v"}})).toMatchObject({status:"SUSPENDED"});
          expect(await p.auditLog.findFirst({where:{entityType:"VILLAGE",entityId:"v"}})).toMatchObject({villageId:"v",actorUserId:"admin",actionType:"STATUS_CHANGE",metadata:{previousStatus:"ACTIVE",newStatus:"SUSPENDED",reason:"Test suspension"}});
        }
        expect(await p.fund.findUnique({where:{id:"v"}})).toMatchObject({status:closed?"CLOSED":"ACTIVE"});
        expect(await p.fundHouseAssessment.count()).toBe(1);
        expect(await p.fundEndDateExtension.count()).toBe(kind==="extend"?1:0);
        expect(await p.auditLog.count({where:{fundId:"v",metadata:{path:["event"],equals:"FUND_CLOSED"}}})).toBe(closed?1:0);
        if (kind === "pay" || nextKind === "pay") {
          const assessment = await p.fundHouseAssessment.findUniqueOrThrow({where:{id:"v"}});
          const payment = await p.payment.findFirstOrThrow({where:{fundHouseAssessmentId:assessment.id,status:"ACCEPTED"}});
          expect(payment).toMatchObject({fundId:"v",villageId:"v",houseId:assessment.houseId,collectorUserId:"v",payerUserId:"v",amount:1001});
          const receipt = await p.receipt.findUniqueOrThrow({where:{paymentId:payment.id}});
          expect(receipt).toMatchObject({paymentId:payment.id,villageId:"v",status:"ACTIVE"});
          expect(await p.auditLog.findFirst({where:{entityId:payment.id,metadata:{path:["event"],equals:"PAYMENT_CREATED"}}})).toMatchObject({fundId:"v",villageId:"v",actorUserId:"v",actionType:"CREATE",entityType:"PAYMENT",metadata:{paymentId:payment.id,houseId:assessment.houseId,assessmentId:assessment.id,amount:1001}});
          expect(await p.auditLog.findFirst({where:{entityId:receipt.id,metadata:{path:["event"],equals:"RECEIPT_CREATED"}}})).toMatchObject({fundId:"v",villageId:"v",actorUserId:"v",actionType:"CREATE",entityType:"RECEIPT",metadata:{paymentId:payment.id,receiptId:receipt.id,receiptNumber:receipt.receiptNumber}});
          if (replacement) expect(await p.auditLog.findFirst({where:{entityId:payment.id,metadata:{path:["event"],equals:"PAYMENT_REPLACED"}}})).toMatchObject({fundId:"v",villageId:"v",actorUserId:"v",metadata:{previousPaymentId:"v",assessmentId:assessment.id,paymentId:payment.id}});
        }
        if (closed) expect(await p.auditLog.findFirst({where:{fundId:"v",metadata:{path:["event"],equals:"FUND_CLOSED"}}})).toMatchObject({actorUserId:"v",villageId:"v",entityId:"v",actionType:"STATUS_CHANGE",metadata:{acceptedPaymentCount:1,termsVersion:3}});
        if(replacement){expect(await p.payment.count({where:{status:"VOIDED"}})).toBe(1);expect(await p.payment.count({where:{status:"ACCEPTED"}})).toBe(1);expect(await p.receipt.count()).toBe(2);}
        if(kind==="void"){expect(await p.payment.count({where:{status:"ACCEPTED"}})).toBe(0);expect(await p.receipt.count({where:{status:"VOIDED"}})).toBe(1);}
      }finally{release.open();committed.open();retry.open();await raw.query("ROLLBACK").catch(console.error);await first;await second;}
    });
  },90000);
  it("revoked Chief is rechecked after a real stale-snapshot retry",async()=>{
    await fixture(true,false,async(p,_other,raw,next)=>{
      const snapshot=gate(),release=gate();const c:Context={client:p,attempts:0,before:async(tx)=>{if(c.attempts===1){await tx.$queryRaw`SELECT id FROM "Village" WHERE id='v'`;snapshot.open();await release.reached;}}};
      const pending=observe(b.request.run(c,()=>extendFundAction(form(next))));
      try{await reach(snapshot,pending);await raw.query("BEGIN");await raw.query(`SELECT vfc_acquire_villages(ARRAY['v'])`);await raw.query(`UPDATE "User" SET role='VILLAGER' WHERE id='v'`);await raw.query("COMMIT");release.open();
        expect(await pending).toMatchObject({error:{path:"/forbidden"}});expect(c.attempts).toBe(2);expect(await p.fundEndDateExtension.count()).toBe(0);expect(await p.auditLog.count()).toBe(0);
      }finally{release.open();await raw.query("ROLLBACK").catch(console.error);await pending;}
    });
  },90000);
  it("replacement restores closure eligibility; ACTIVE Fund blocks real Village suspension",async()=>{
    await fixture(false,true,async(p,_other,_raw,next)=>{
      const c:Context={client:p,attempts:0};
      expect(await b.request.run({...c,actor:"admin"},()=>operation("suspend",next))).toBe("blocked_by_active_fund");
      expect(await b.request.run(c,()=>operation("void",next))).toEqual({success:true});
      expectClosure(await observe(b.request.run(c,()=>closeFundAction(form(next)))), unpaidClosure);
      expect(await b.request.run(c,()=>operation("pay",next))).toEqual({success:true});
      await expect(b.request.run(c,()=>closeFundAction(form(next)))).rejects.toMatchObject({path:"/village/funds/v"});
      expect(await p.payment.count({where:{status:"ACCEPTED"}})).toBe(1);expect(await p.payment.count({where:{status:"VOIDED"}})).toBe(1);
      expect(await p.receipt.count()).toBe(2);expect(await p.auditLog.count({where:{fundId:"v"}})).toBe(6);
    });
  },90000);
});

// Non-database presentation tests live here to keep the correction within its
// approved file boundary. They run outside the database opt-in describe block.
const rejectionCases = [
  ["Only active funds can be extended or closed.", "funds.completion.error.inactive"],
  ["Fund details have changed. Reload the form.", "funds.completion.error.stale"],
  ["Extension date and reason are required.", "funds.completion.error.required"],
  ["Only expired funds can be extended.", "funds.completion.error.notExpired"],
  ["Only funds with unpaid assessments can be extended.", "funds.completion.error.paid"],
  ["New end date must be later than the previous end date.", "funds.completion.error.later"],
  ["Every assessed house must have an accepted payment before closure.", "funds.completion.error.unpaid"],
  ["New end date is invalid.", "funds.completion.error.date"],
  ["Extension reason is required.", "funds.completion.error.reason"],
  ["Fund not found.", "funds.completion.error.missing"],
  ["This village is read-only because it is scheduled for deactivation. No changes can be made.", "funds.completion.error.readOnly"],
] as const;
function presentation(message: unknown, language: "EN" | "MY", lifecycle = false) {
  const children = lifecycle
    ? createElement(FundLifecycleActions, { fundId:"v", termsVersion:2, status:"ACTIVE", hasOtherActiveFund:false, unpaidCount:0, lifecycleError:message as string })
    : createElement(FundCompletionError, { message });
  return renderToStaticMarkup(createElement(TranslationProvider, { language }, children));
}
function escaped(text: string) {
  return text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#x27;");
}
describe("Phase 6 presentation-only rejection localization", () => {
  it.each(rejectionCases)("renders known rejection %s in both languages", (message,key) => {
    for (const language of ["EN","MY"] as const) {
      const text = (language === "EN" ? en : my)[key];
      expect(presentation(message,language)).toContain(escaped(text));
      expect(presentation(message,language,true)).toContain(escaped(text));
    }
  });
  it.each(["private database diagnostic", "constructor", "__proto__", new Error("private failure"), null, undefined])("never renders unknown input %s as a recognized rejection", (message) => {
    for (const language of ["EN","MY"] as const) {
      const markup = presentation(message,language);
      expect(markup).toContain(escaped((language === "EN" ? en : my)["common.error"]));
      if (typeof message === "string") expect(markup).not.toContain(message);
    }
  });
  it("preserves the initial closure confirmation step and submitted identity", () => {
    for (const language of ["EN","MY"] as const) {
      const text = language === "EN" ? en : my;
      const markup = presentation(unpaidClosure,language,true);
      expect(markup).toContain(escaped(text["funds.lifecycle.close"]));
      expect(markup).toContain('name="fundId"'); expect(markup).toContain('value="v"');
      expect(markup).toContain('name="termsVersion"'); expect(markup).toContain('value="2"');
      expect(markup).not.toContain('type="submit"');
      expect(markup).not.toContain(escaped(text["funds.lifecycle.closeConfirm"]));
    }
  });
});
