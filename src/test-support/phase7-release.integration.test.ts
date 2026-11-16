/** Real PostgreSQL correctness gate. Authentication claims/routing only are injected.
 * Page rendering/hydration remains the genuine-session browser checklist.
 */
import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import type { PrismaClient, Prisma } from "@prisma/client";
import { buildReleaseFixture } from "./phase7-release-fixtures";
const b = await vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  return { context: new AsyncLocalStorage<{ id: string; village: string; role: "CHIEF" | "VILLAGER"; hook?: () => Promise<void> }>(), client: null as PrismaClient | null };
});
function actor() { const user = b.context.getStore(); if (!user) throw new Error("Missing request identity"); return user; }
function auth() { const a=actor(); return { user: { id:a.id, role:a.role, villageId:a.village, membershipStatus:"ACTIVE", mustChangePassword:false }, villageId:a.village }; }
vi.mock("@/lib/auth/session-identity", () => ({getSessionIdentity: async()=>({userId:actor().id,sessionVersion:0})}));
vi.mock("@/lib/auth/guards",()=>({requireAuthenticatedUser:async()=>auth().user}));
vi.mock("@/lib/authz", async()=>({ ...await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz"), requireChief:async()=>auth(),requireActiveCollector:async()=>auth() }));
vi.mock("@/lib/authz/roles",()=>({requireChief:async()=>auth(),requireVillager:async()=>auth()}));
vi.mock("next/navigation",()=>({redirect:(url:string)=>{throw new Error(`redirect:${url}`);},notFound:()=>{throw new Error("unavailable");}}));
vi.mock("@/lib/prisma",()=>({prisma:new Proxy({}, {get(_target,key){
  if(!b.client)throw new Error("Owned child unavailable");
  const client=b.client;
  if(key==="$transaction")return (body:(tx:Prisma.TransactionClient)=>Promise<unknown>,options:object)=>client.$transaction(async tx=>{
    const request=actor();
    // The actor read has established a real Repeatable Read snapshot before
    // pausing. Another connection must commit its real operation before resume.
    const wrapped=new Proxy(tx,{get(target,method){
      if(method==="user")return new Proxy(target.user,{get(model,operation){
        if(operation==="findUnique")return async (...args:unknown[])=>{
          const value=await Reflect.apply(model.findUnique,model,args);
          await request.hook?.(); return value;
        };
        const value=Reflect.get(model,operation);return typeof value==="function"?value.bind(model):value;
      }});
      const value=Reflect.get(target,method);return typeof value==="function"?value.bind(target):value;
    }});
    return body(wrapped);
  },options);
  const value=Reflect.get(client,key);return typeof value==="function"?value.bind(client):value;
}})}));
import { getChiefFundReport } from "@/features/fund-management/lib/fund-report-queries";
import { getChiefFundReconciliation } from "@/features/fund-management/lib/fund-reconciliation-queries";
import { getMemberCurrentFund } from "@/features/fund-management/lib/member-fund-query";
import { getCashHistory, getReceiptHistory } from "@/features/payment-history/lib/history-queries";
import { getChiefFundLifecycleHistory, withChiefFundHistorySnapshot } from "@/features/fund-management/lib/fund-lifecycle-history";
import { getChiefFundAuditLogs } from "@/features/audit/lib/audit-queries";
import { parseAuditFilters } from "@/features/audit/lib/audit-filters";
import { encodeHistoryCursor } from "@/features/payment-history/lib/history-cursor";
import { parseHistoryFilters } from "@/features/payment-history/lib/history-filters";
import { parseFinancialDateRange } from "@/lib/financial-date-range";
import { voidPaymentAction } from "@/features/cash-payment/actions/void-payment.action";
import { recordCashPaymentAction } from "@/features/cash-payment/actions/record-cash-payment.action";
import { inspectDatabaseError } from "@/lib/db/database-errors";
function gate(){let open!:()=>void;const promise=new Promise<void>(resolve=>{open=resolve;});return {open,promise};}
const enabled=process.env.VFC_RUN_PHASE7_RELEASE==="1"&&process.env.VFC_RUN_REPORT_POSTGRES_TESTS==="1"&&process.env.TEST_DATABASE_ALLOW_REMOTE==="1";
describe.skipIf(!enabled)("Phase 7 release correctness (owned child)",{concurrent:false,shuffle:false},()=>{
  let sandbox:Awaited<ReturnType<typeof import("./report-postgres-sandbox").startReportPostgresSandbox>>|undefined;
  let fixture:Awaited<ReturnType<typeof buildReleaseFixture>>;
  const current=()=>fixture.villages[0];
  function as<T>(id:string,role:"CHIEF"|"VILLAGER",work:()=>Promise<T>,hook?:()=>Promise<void>){return b.context.run({id,role,village:current().id,hook},work);}
  const chief=<T>(work:()=>Promise<T>,hook?:()=>Promise<void>)=>as(current().chief,"CHIEF",work,hook);
  const collector=<T>(work:()=>Promise<T>)=>as(current().collector,"VILLAGER",work);
  beforeAll(async()=>{
    const { requireReleaseOptIns }=await import("./phase7-release-sandbox");requireReleaseOptIns("migrated");
    const { startReportPostgresSandbox }=await import("./report-postgres-sandbox");sandbox=await startReportPostgresSandbox();
    b.client=sandbox.db.prisma;fixture=await buildReleaseFixture(sandbox.db);
  },0);
  afterAll(async()=>{b.client=null;await sandbox?.dispose();},0);
  beforeEach(()=>{if(!sandbox||!b.client)throw new Error("Sandbox setup failed");});
  it("report-backed dashboard/detail metrics, member coverage and reconciliation agree",async()=>{
    const report=await chief(()=>getChiefFundReport(current().active));
    const recon=await chief(()=>getChiefFundReconciliation(current().active));
    expect(recon.clean).toBe(true);expect(recon.metrics).toEqual(report.metrics);
    expect(report.metrics).toMatchObject({acceptedCollectionAmount:26026,outstandingHouseholdObligations:28028,remainingVillageTarget:27975,roundingSurplus:53});
    expect(await as(current().payer,"VILLAGER",getMemberCurrentFund)).toMatchObject({household:{state:"PAID",outstandingAmount:0}});
    // Actual page wiring is exercised by existing page-reader tests and browser gate.
  });
  it("DRAFT metrics remain null and CLOSED metrics/lifecycle use persisted facts",async()=>{
    expect((await chief(()=>getChiefFundReport(current().draft))).metrics).toMatchObject({expectedHouseholdAssessmentTotal:null,outstandingHouseholdObligations:null});
    const closed=await chief(()=>getChiefFundLifecycleHistory(current().closed));
    expect(closed.fund.closedAt).not.toBeNull();expect(closed.fund.closedByUserId).toBe(current().chief);expect(closed.closureWarning).toBe(false);
    expect((await chief(()=>getChiefFundReport(current().closed))).metrics.isComplete).toBe(true);
    const active=await chief(()=>getChiefFundLifecycleHistory(current().active));
    expect(active.extensions).toHaveLength(1);expect(active.extensions[0]).toMatchObject({previousTermsVersion:2,newTermsVersion:3,reason:"Release fixture extension",evidenceWarning:false});
  });
  async function traverse(kind:"cash"|"receipt"){
    const ids:string[]=[];let cursor:string|null=null;
    for(let page=0;page<20;page++){
      const result=await (kind==="cash"?collector(()=>getCashHistory(cursor?{cursor,direction:"older"}:{})):chief(()=>getReceiptHistory(cursor?{cursor,direction:"older"}:{})));
      if(!result.ok)throw new Error("History traversal rejected");
      ids.push(...(kind==="cash"?result.payments:result.receipts).map(row=>row.id));cursor=result.older;if(!cursor)break;
    }
    expect(cursor).toBeNull();expect(new Set(ids).size).toBe(ids.length);
    const expected=kind==="cash"?await b.client!.payment.findMany({where:{villageId:current().id},orderBy:[{createdAt:"desc"},{id:"desc"}]}):await b.client!.receipt.findMany({where:{villageId:current().id},orderBy:[{payment:{createdAt:"desc"}},{id:"desc"}]});
    expect(ids).toEqual(expected.map(row=>row.id));expect(ids.length).toBeGreaterThan(kind==="cash"?20:50);
  }
  it("cash keyset traversal retains every tied-timestamp identity beyond 20",()=>traverse("cash"));
  it("receipt keyset traversal retains every tied-timestamp identity beyond 50",()=>traverse("receipt"));
  it("binds cursors to filters and scopes Fund options and unavailable targets",async()=>{
    const page=await collector(()=>getCashHistory());if(!page.ok)throw new Error("History rejected");expect(page.older).not.toBeNull();
    expect(await collector(()=>getCashHistory({cursor:page.older!,direction:"older",status:"VOIDED"}))).toMatchObject({ok:false,error:"CURSOR"});
    for(const fundId of [fixture.villages[1].active,"missing-release-fund"])
      expect(await collector(()=>getCashHistory({fundId}))).toMatchObject({ok:false,error:"UNAVAILABLE"});
    const personal=await as(current().payer,"VILLAGER",()=>getReceiptHistory());if(!personal.ok)throw new Error("Personal history rejected");
    const allowed=await b.client!.receipt.findMany({where:{payment:{payerUserId:current().payer}}});
    expect(personal.receipts.map(r=>r.id).sort()).toEqual(allowed.map(r=>r.id).sort());
    expect(personal.funds.some(f=>f.id===current().other)).toBe(false);
    expect(await as(current().payer,"VILLAGER",()=>getReceiptHistory({fundId:current().other}))).toMatchObject({ok:false,error:"UNAVAILABLE"});
    await expect(as(current().former,"VILLAGER",()=>getCashHistory())).rejects.toThrow();
    const former=await as(current().former,"VILLAGER",()=>getReceiptHistory());expect(former.ok).toBe(true);
    if(former.ok){expect(former.funds.some(f=>f.id===current().other)).toBe(false);const own=await b.client!.receipt.findMany({where:{payment:{payerUserId:current().former}}});expect(former.receipts.map(r=>r.id).sort()).toEqual(own.map(r=>r.id).sort());}
    expect(await as(current().former,"VILLAGER",()=>getReceiptHistory({fundId:current().other}))).toMatchObject({ok:false,error:"UNAVAILABLE"});
  });
  it("resolves foreign and missing cursor anchors only inside the authorized dataset",async()=>{
    const filters=parseHistoryFilters({});if(!filters.ok)throw new Error("Invalid fixture filters");
    for(const id of ["missing-release-anchor",`${fixture.villages[1].active}-p0`]){
      const cursor=encodeHistoryCursor("cash",filters,id);
      expect(await collector(()=>getCashHistory({cursor,direction:"older"}))).toMatchObject({ok:false,error:"STALE"});
    }
  });
  it.each(["cash","receipt"] as const)("%s applies exact [gte,lt) Yangon payment boundaries, independently of receipt time",async kind=>{
    const v=current(),fundId=v.boundary,params={fundId,dateFrom:fixture.day,dateTo:fixture.day};
    const result=kind==="cash"?await collector(()=>getCashHistory(params)):await chief(()=>getReceiptHistory(params));
    if(!result.ok)throw new Error("Boundary history rejected");
    const ids=(kind==="cash"?result.payments:result.receipts).map(row=>row.id).sort();
    expect(ids).toEqual([1,2].map(h=>`${fundId}-p${h}${kind==="receipt"?"-r":""}`).sort());
    const range=parseFinancialDateRange(fixture.day,fixture.day);if(!range.ok)throw new Error("Invalid boundary range");
    const stored=await b.client!.payment.findMany({where:{fundId,id:{in:[0,1,2,3].map(h=>`${fundId}-p${h}`)}},include:{receipt:true},orderBy:{id:"asc"}});
    expect(stored.map(p=>p.createdAt)).toEqual(fixture.instants);
    for(const row of stored.filter(p=>p.id.endsWith("p1")||p.id.endsWith("p2")))expect(row.receipt!.createdAt.getTime()).toBeGreaterThanOrEqual(range.lt!.getTime());
    expect(stored[0].receipt!.createdAt).toEqual(range.gte);
    expect(result.older).toBeNull();
  });
  it("post-activation household is not assessed and persisted frozen identity survives live rename",async()=>{
    expect(await as(current().newcomer,"VILLAGER",getMemberCurrentFund)).toMatchObject({household:{state:"NOT_ASSESSED",assessmentAmount:null,outstandingAmount:null}});
    await b.client!.house.update({where:{id:`${current().id}-h2`},data:{houseNumber:"Renamed live house"}});
    const target=`${current().active}-p2`;let cursor:string|null=null;let found=false;
    for(let page=0;page<10;page++){
      const result=await collector(()=>getCashHistory({fundId:current().active,...(cursor?{cursor,direction:"older"}:{})}));
      if(!result.ok)throw new Error("Frozen history rejected");
      const row=result.payments.find(p=>p.id===target);
      if(row){expect(row.assessment.houseNumberSnapshot).toBe("Frozen 2");
        const live=await b.client!.house.findUniqueOrThrow({where:{id:`${current().id}-h2`}});expect(row.assessment.houseNumberSnapshot).not.toBe(live.houseNumber);
        const receipt=await b.client!.receipt.findUniqueOrThrow({where:{paymentId:row.id}});expect(receipt.id).toBe(`${target}-r`);expect(receipt.paymentId).toBe(target);found=true;break;}
      cursor=result.older;if(!cursor)break;
    }
    expect(found).toBe(true);
    expect((await chief(()=>getChiefFundReport(current().active))).metrics.outstandingHouseholdObligations).toBe(28028);
  });
  it.each(["sessionVersion","mustChangePassword","membershipStatus"] as const)("reauthorizes persisted %s",async(field)=>{
    const id=`${current().id}-u54`;const before=await b.client!.user.findUniqueOrThrow({where:{id}});
    try{
      await b.client!.user.update({where:{id},data:field==="sessionVersion"?{sessionVersion:1}:field==="mustChangePassword"?{mustChangePassword:true}:{membershipStatus:"REMOVED"}});
      await expect(as(id,"VILLAGER",()=>getReceiptHistory())).rejects.toThrow();
    }finally{await b.client!.user.update({where:{id},data:{sessionVersion:before.sessionVersion,mustChangePassword:before.mustChangePassword,membershipStatus:before.membershipStatus}});}
  });
  it("Fund audit scope includes linked entities and excludes foreign records",async()=>{
    const logs=await chief(()=>getChiefFundAuditLogs(current().active,parseAuditFilters({})));
    expect(logs.total).toBeGreaterThan(25);expect(logs.logs.every(log=>log.fundId===current().active)).toBe(true);
    await expect(chief(()=>getChiefFundAuditLogs(fixture.villages[1].active,parseAuditFilters({})))).rejects.toThrow("unavailable");
  });
  it.each(["history","reconciliation"])("keeps %s snapshot while another real action commits a void",async(kind)=>{
    const paymentId=`${current().active}-p${kind==="history"?24:25}`;
    const snapshot=gate(),resume=gate();
    const hook=async()=>{snapshot.open();await resume.promise;};
    const read=kind==="history"?chief(()=>getReceiptHistory({fundId:current().active,status:"ACCEPTED"}),hook):chief(()=>getChiefFundReconciliation(current().active),hook);
    const observed=read.then(value=>({value}),error=>({error}));
    try{
      await Promise.race([snapshot.promise,observed.then(()=>{throw new Error("Reader ended before snapshot barrier");})]);
      const data=new FormData();data.set("paymentId",paymentId);data.set("voidReason","Release concurrency correction");
      expect(await collector(()=>voidPaymentAction(data))).toEqual({success:true});
    }finally{resume.open();await observed;}
    const out=await observed;if("error"in out)throw out.error;
    const boundFilters=parseHistoryFilters({fundId:current().active,status:"ACCEPTED"});if(!boundFilters.ok)throw new Error("Invalid fixture filter");
    const staleCursor=encodeHistoryCursor("cash",boundFilters,paymentId);
    expect(await collector(()=>getCashHistory({fundId:current().active,status:"ACCEPTED",cursor:staleCursor,direction:"older"}))).toMatchObject({ok:false,error:"STALE"});
    const original=await b.client!.payment.findUniqueOrThrow({where:{id:paymentId}});expect(original.status).toBe("VOIDED");
    if(kind==="history")expect(out.value).toMatchObject({ok:true,receipts:expect.arrayContaining([expect.objectContaining({payment:expect.objectContaining({id:paymentId,status:"ACCEPTED"})})])});
    else expect(out.value).toMatchObject({metrics:{acceptedCollectionAmount:26026}});
    const form=new FormData();for(const [key,value]of Object.entries({fundId:current().active,termsVersion:"3",houseId:original.houseId,payerUserId:original.payerUserId!,amount:"1001"}))form.set(key,value);
    expect(await collector(()=>recordCashPaymentAction(form))).toEqual({success:true});
    const replacement=await b.client!.payment.findFirstOrThrow({where:{fundHouseAssessmentId:original.fundHouseAssessmentId,status:"ACCEPTED"},include:{receipt:true}});
    expect(replacement.id).not.toBe(paymentId);expect(replacement.receipt!.receiptNumber).not.toBe(`${paymentId}-r`);
    expect((await chief(()=>getChiefFundReconciliation(current().active))).metrics?.acceptedCollectionAmount).toBe(26026);
  });
  it("missing historical audit actor is UNVERIFIED while valid financial metrics remain available",async()=>{
    const id=`${current().id}-unattributed`;
    await b.client!.$transaction(async tx=>{
      await tx.fund.create({data:{id,villageId:current().id,name:"Unattributed draft",villageTargetAmount:1001,startDate:new Date("2026-01-01"),endDate:new Date("2099-01-01")}});
      await tx.auditLog.create({data:{villageId:current().id,fundId:id,entityType:"FUND",entityId:id,actionType:"CREATE",actorUserId:null,metadata:{event:"DRAFT_CREATED",termsVersion:1,villageTargetAmount:1001}}});
    });
    const result=await chief(()=>getChiefFundReconciliation(id));expect(result.clean).toBe(false);expect(result.metrics).not.toBeNull();
    expect(result.findings).toEqual(expect.arrayContaining([expect.objectContaining({outcome:"UNVERIFIED",code:"ACTOR_UNAVAILABLE"})]));
  });
  it("assignment revocation is rechecked before cash history and former access is personal only",async()=>{
    const assignment=await b.client!.collectorAssignment.findFirstOrThrow({where:{userId:current().collector,isActive:true}});
    try{await b.client!.collectorAssignment.update({where:{id:assignment.id},data:{isActive:false}});
      await expect(collector(()=>getCashHistory())).rejects.toThrow();
      const result=await collector(()=>getReceiptHistory());expect(result.ok).toBe(true);if(result.ok){const own=await b.client!.receipt.findMany({where:{payment:{payerUserId:current().collector}}});expect(result.receipts.map(r=>r.id).sort()).toEqual(own.map(r=>r.id).sort());}
    }finally{await b.client!.collectorAssignment.update({where:{id:assignment.id},data:{isActive:true}});}
  });
  it("no household and platform identities do not acquire household or Chief data",async()=>{
    const member=`${current().id}-nohouse`,admin=`${current().id}-admin`;
    await b.client!.user.create({data:{id:member,villageId:current().id,role:"VILLAGER",membershipStatus:"ACTIVE",name:"No house",passwordHash:"not-a-login-password"}});
    await b.client!.user.create({data:{id:admin,role:"SYSTEM_ADMIN",membershipStatus:"ACTIVE",name:"Synthetic admin",passwordHash:"not-a-login-password"}});
    expect(await as(member,"VILLAGER",getMemberCurrentFund)).toMatchObject({household:{state:"NO_HOUSEHOLD",assessmentAmount:null,outstandingAmount:null}});
    await expect(as(admin,"CHIEF",()=>getChiefFundReconciliation(current().active))).rejects.toThrow();
    await expect(as(current().payer,"VILLAGER",()=>getChiefFundReconciliation(current().active))).rejects.toThrow();
  });
  it("a concurrent accepted payment cannot alter an established report snapshot",async()=>{
    const before=await chief(()=>getChiefFundReport(current().active));const reached=gate(),resume=gate();
    const observed=chief(()=>getChiefFundReport(current().active),async()=>{reached.open();await resume.promise;}).then(value=>({value}),error=>({error}));
    try{
      await Promise.race([reached.promise,observed.then(()=>{throw new Error("Snapshot barrier not reached");})]);
      const form=new FormData();for(const [key,value]of Object.entries({fundId:current().active,termsVersion:"3",houseId:`${current().id}-h30`,payerUserId:`${current().id}-u30`,amount:"1001"}))form.set(key,value);
      expect(await collector(()=>recordCashPaymentAction(form))).toEqual({success:true});
    }finally{resume.open();await observed;}
    const out=await observed;if("error"in out)throw out.error;
    expect(out.value.metrics).toEqual(before.metrics);
    expect((await chief(()=>getChiefFundReport(current().active))).metrics.acceptedCollectionAmount).toBe(before.metrics.acceptedCollectionAmount+1001);
  });
  it("propagates unexpected errors and PostgreSQL read-only rejection, then recovers",async()=>{
    const unexpected=new Error("release unexpected error");
    await expect(chief(()=>withChiefFundHistorySnapshot(current().active,async()=>{throw unexpected;}))).rejects.toBe(unexpected);
    let failure:unknown;
    try{await chief(()=>withChiefFundHistorySnapshot(current().active,async tx=>{await tx.$executeRaw`UPDATE "Fund" SET name=name WHERE id=${current().active}`;}));}catch(error){failure=error;}
    expect(inspectDatabaseError(failure).sqlStates).toContain("25006");
    expect((await chief(()=>getChiefFundReport(current().active))).fund.id).toBe(current().active);
  });
});
