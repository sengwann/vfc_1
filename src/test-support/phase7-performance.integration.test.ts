/** Opt-in real readers/PostgreSQL. Nothing connects without all safety opt-ins. */
import { createHash } from "node:crypto";
import { describe,it,expect,vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { buildPerformanceFixture,requireFinancialGuards,expectedBoundaryOutcome,type DatasetCardinalities,type FinancialTrigger,type PerformanceProfile } from "./phase7-performance-fixtures";
import { observePool,runLoad,summarize,observationGaps,type Sample } from "./phase7-performance-measurements";
const boundary=vi.hoisted(()=>({client:null as PrismaClient|null,user:{id:"",villageId:"",role:"CHIEF",membershipStatus:"ACTIVE",mustChangePassword:false,name:"Synthetic",houseId:null,email:null,phone:null,dateOfBirth:null}}));
vi.mock("@/lib/prisma",()=>({get prisma(){if(!boundary.client)throw new Error("Validated child client not open");return boundary.client;}}));
vi.mock("@/lib/auth/session-identity",()=>({getSessionIdentity:async()=>({userId:boundary.user.id,sessionVersion:0})}));
vi.mock("@/lib/auth/guards",()=>({requireAuthenticatedUser:async()=>boundary.user}));
vi.mock("@/lib/authz",async()=>{
  const actual=await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return {...actual,requireChief:async()=>{if(boundary.user.role!=="CHIEF")throw new Error("Chief required");return {user:boundary.user,villageId:boundary.user.villageId};},requireActiveCollector:async()=>({user:boundary.user,villageId:boundary.user.villageId})};
});
vi.mock("@/lib/authz/roles",()=>({requireChief:async()=>{if(boundary.user.role!=="CHIEF")throw new Error("Chief required");return {user:boundary.user,villageId:boundary.user.villageId};}}));
const enabled=process.env.VFC_RUN_PHASE7_PERFORMANCE==="1" && process.env.VFC_RUN_REPORT_POSTGRES_TESTS==="1" && process.env.TEST_DATABASE_ALLOW_REMOTE==="1" && process.env.NODE_ENV!=="production";
describe.skipIf(!enabled)("Phase 7 performance (owned Neon child only)",{concurrent:false,shuffle:false},()=>{
  it("measures actual readers serially by scenario with controlled concurrent requests",async()=>{
    const raw=process.env.VFC_PERF_PROFILE??"primary";
    if(!["primary","comparison","concentrated","boundary"].includes(raw))throw new Error("Unknown performance profile");
    const combined=process.env.VFC_PERF_COMBINED==="1";
    const history=Number(process.env.VFC_PERF_HISTORY??24),rows=Number(process.env.VFC_PERF_BOUNDARY_ROWS??10000);
    const {startReportPostgresSandbox}=await import("./report-postgres-sandbox");
    const sandbox=await startReportPostgresSandbox();
    let observation:ReturnType<typeof observePool>|undefined;
    const failures:unknown[]=[];
    try {
      const triggers=await sandbox.db.pool.query<FinancialTrigger>(`SELECT r.relname AS table_name,t.tgname,t.tgenabled,t.tgtype,t.tgdeferrable,t.tginitdeferred,t.tgnargs,(t.tgqual IS NULL) AS unconditional,p.proname AS function_name,pn.nspname AS function_schema FROM pg_trigger t JOIN pg_class r ON r.oid=t.tgrelid JOIN pg_namespace n ON n.oid=r.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace WHERE n.nspname='public' AND NOT t.tgisinternal`);
      requireFinancialGuards(triggers.rows,(await sandbox.db.pool.query("SHOW session_replication_role")).rows[0].session_replication_role);
      // Record inherited cardinality, never delete inherited rows. Bound discovery work.
      const baseline = Number((await sandbox.db.pool.query(`SELECT count(*) AS count FROM "AuditLog" WHERE "entityType"='VILLAGE'`)).rows[0].count);
      if (baseline > 10000) throw new Error("Inherited village-audit baseline exceeds bounded discovery budget");
      const fixture=await buildPerformanceFixture(sandbox.db,raw as PerformanceProfile,history,rows,combined);
      boundary.client=sandbox.db.prisma;
      const v=fixture.villages[0];boundary.user={...boundary.user,id:v.chief,villageId:v.id};
      const {getChiefFundReport}=await import("@/features/fund-management/lib/fund-report-queries");
      const {getChiefFundReconciliation}=await import("@/features/fund-management/lib/fund-reconciliation-queries");
      const {getChiefFundLifecycleHistory}=await import("@/features/fund-management/lib/fund-lifecycle-history");
      const {getChiefFundAuditLogs,getChiefAuditLogs,getPlatformAuditLogs}=await import("@/features/audit/lib/audit-queries");
      const {parseAuditFilters}=await import("@/features/audit/lib/audit-filters");
      const {getCashHistory,getReceiptHistory}=await import("@/features/payment-history/lib/history-queries");
      const syntheticIds=new Set(fixture.villageAuditIds);
      const discovered=new Set<string>();
      const platformTotal=baseline+syntheticIds.size;
      // Discover all synthetic identities before measurement; inherited IDs cannot satisfy this.
      for(let page=1;page<=Math.ceil(platformTotal/25);page++) {
        const result=await getPlatformAuditLogs({filters:parseAuditFilters({page:String(page)})});
        expect(result.total).toBe(platformTotal);
        for(const log of result.logs) if(syntheticIds.has(log.id)) discovered.add(log.id);
      }
      expect([...discovered].sort()).toEqual([...syntheticIds].sort());
      const cardinalities: Record<string,DatasetCardinalities>={};
      for(const fundId of [v.active,...(fixture.boundaryAuditFund?[fixture.boundaryAuditFund]:[])]) {
        const counts=(await sandbox.db.pool.query<DatasetCardinalities>(`SELECT
          (SELECT count(*)::int FROM "FundHouseAssessment" WHERE "fundId"=$1) AS assessments,
          (SELECT count(*)::int FROM "Payment" WHERE "fundId"=$1) AS payments,
          (SELECT count(*)::int FROM "Receipt" r JOIN "Payment" p ON p.id=r."paymentId" WHERE p."fundId"=$1) AS receipts,
          (SELECT count(*)::int FROM "FundEndDateExtension" WHERE "fundId"=$1) AS lifecycle,
          (SELECT count(*)::int FROM "AuditLog" WHERE "fundId"=$1) AS audit`,[fundId])).rows[0];
        cardinalities[fundId]=counts;
      }
      if(raw==="boundary") {
        expect(cardinalities[v.active]).toEqual({assessments:rows,payments:combined?rows:0,receipts:combined?rows:0,lifecycle:combined?rows:1,audit:combined?6*rows-1:3});
        expect(cardinalities[v.draft]).toEqual({assessments:0,payments:0,receipts:0,lifecycle:0,audit:rows});
      }
      const checkReconciliation=(value:unknown,fundId:string)=>{
        const result=value as Awaited<ReturnType<typeof getChiefFundReconciliation>>;
        const expected=expectedBoundaryOutcome(cardinalities[fundId]);
        if(fundId===v.draft) expected.checks.lifecycle="NOT_APPLICABLE";
        expect(result.checks).toEqual(expected.checks);
        expect(result.findings.filter((f)=>f.outcome==="DISCREPANCY")).toEqual([]);
        expect(result.findings.filter((f)=>f.code==="INPUT_INCOMPLETE").map((f)=>`${f.category}:${f.recordId}`).sort()).toEqual(expected.incomplete);
        expect(result.clean).toBe(expected.incomplete.length===0);
        if(expected.metricsAvailable) expect(result.metrics).not.toBeNull(); else expect(result.metrics).toBeNull();
        if(fundId===v.active && result.metrics) expect(result.metrics.acceptedCollectionAmount).toBe(v.paid*1001);
      };
      observation=observePool(sandbox.db.pool);
      const reports:unknown[]=[];
      const requiresTransaction=(name:string)=>!["village-audit","platform-audit-populated","platform-audit-empty"].includes(name);
      type Scenario={name:string;id?:string;role?:string;slow?:boolean;read:()=>Promise<unknown>;check:(value:unknown)=>void};
      const scenarios:Scenario[]=[
        {name:"report",slow:true,read:()=>getChiefFundReport(v.active),check:(value)=>expect(value).toMatchObject({metrics:{acceptedCollectionAmount:v.paid*1001,outstandingHouseholdObligations:(v.houses-v.paid)*1001}})},
        {name:"reconciliation",slow:true,read:()=>getChiefFundReconciliation(v.active),check:(value)=>checkReconciliation(value,v.active)},
        {name:"lifecycle",read:()=>getChiefFundLifecycleHistory(v.active),check:(value)=>{const result=value as Awaited<ReturnType<typeof getChiefFundLifecycleHistory>>;expect(result.stale).toBe(false);expect(result.extensions.length).toBeGreaterThan(0);expect(result.extensions.every((e)=>!e.evidenceWarning)).toBe(true);}},
        {name:"draft-report",slow:true,read:()=>getChiefFundReport(v.draft),check:(value)=>expect(value).toMatchObject({metrics:{outstandingHouseholdObligations:null}})},
        ...([1,20].map((page)=>({name:`fund-audit-${page}`,read:()=>getChiefFundAuditLogs(v.active,parseAuditFilters({page:String(page)})),check:(value:unknown)=>expect(value).toHaveProperty("logs")}))),
        {name:"village-audit",read:()=>getChiefAuditLogs({villageId:v.id,filters:parseAuditFilters({})}),check:(value)=>expect(value).toHaveProperty("logs")},
        {name:"platform-audit-populated",read:()=>getPlatformAuditLogs({filters:parseAuditFilters({})}),check:(value)=>{
          const result=value as Awaited<ReturnType<typeof getPlatformAuditLogs>>;
          expect(result.total).toBe(platformTotal);expect(result.logs).toHaveLength(25);
          // Fail closed if inherited/future-dated rows obscure the controlled first page.
          expect(result.logs.every((log)=>syntheticIds.has(log.id))).toBe(true);
        }},
        {name:"platform-audit-empty",read:()=>getPlatformAuditLogs({filters:parseAuditFilters({dateFrom:"2099-01-01",dateTo:"2099-01-01"})}),check:(value)=>{
          const result=value as Awaited<ReturnType<typeof getPlatformAuditLogs>>;
          expect(result.logs,"Unexpected platform audit records in the reserved 2099-01-01 Yangon window").toEqual([]);
          expect(result.total,"Expected zero platform audit records in the reserved 2099-01-01 Yangon window").toBe(0);
        }},
      ];
      if(fixture.boundaryAuditFund) scenarios.push({name:"audit-cap-reconciliation",slow:true,read:()=>getChiefFundReconciliation(fixture.boundaryAuditFund!),check:(value)=>checkReconciliation(value,fixture.boundaryAuditFund!)});
      if(v.closed.length)scenarios.push({name:"closed-report",slow:true,read:()=>getChiefFundReport(v.closed[0]),check:(value)=>expect(value).toMatchObject({metrics:{isComplete:true,acceptedCollectionAmount:v.houses*1001}})});
      for(const [role,id] of [["CHIEF",v.chief],["VILLAGER",v.collector],["VILLAGER",v.payer],["VILLAGER",v.former]]){
        scenarios.push({name:`receipts-${id===v.chief?"chief":id===v.collector?"collector":id===v.former?"former":"payer"}`,id,role,read:()=>getReceiptHistory(),check:(value)=>{
          const result=value as Awaited<ReturnType<typeof getReceiptHistory>>;expect(result.ok).toBe(true);
          if(result.ok && id!==v.chief && id!==v.collector) {
            expect(result.accessLevel).toBe("own");
            const house=id===v.former?3:2;
            expect(result.receipts.every((r)=>r.id.includes(`-p${house}-`))).toBe(true);
            expect(result.funds.every((fund)=>fund.id.startsWith(v.id+"-f"))).toBe(true);
          }
        }});
      }
      if(raw!=="boundary")scenarios.push({name:"cash-first",id:v.collector,role:"VILLAGER",read:()=>getCashHistory(),check:(value)=>expect(value).toMatchObject({ok:true})});
      // Prepare reusable deep-page anchors outside measured samples. Every timed
      // request still reauthorizes and resolves its anchor in the real reader.
      if(raw!=="boundary") {
        boundary.user={...boundary.user,id:v.collector,role:"VILLAGER"};
        for(const kind of ["cash","receipt"] as const) {
          const reader=kind==="cash"?getCashHistory:getReceiptHistory;
          let cursor:string|undefined;
          for(let depth=0;depth<10;depth++) {
            const page=await reader(cursor?{cursor,direction:"older"}:{});
            if(!page.ok||!page.older)break;
            cursor=page.older;
          }
          if(cursor) {
            const anchor=cursor;
            scenarios.push({name:`${kind}-deep`,id:v.collector,role:"VILLAGER",read:()=>reader({cursor:anchor,direction:"older"}),check:(value)=>expect(value).toMatchObject({ok:true})});
          }
          for(const status of ["ACCEPTED","VOIDED"] as const) scenarios.push({name:`${kind}-${status}`,id:v.collector,role:"VILLAGER",read:()=>reader({fundId:v.closed[0],status,dateFrom:"2000-01-01",dateTo:"9999-12-30"}),check:(value)=>expect(value).toMatchObject({ok:true})});
          scenarios.push({name:`${kind}-empty`,id:v.collector,role:"VILLAGER",read:()=>reader({dateFrom:"2000-01-01",dateTo:"2000-01-01"}),check:(value)=>expect(value).toMatchObject(kind==="cash"?{ok:true,payments:[]}:{ok:true,receipts:[]})});
        }
      }
      for(const scenario of scenarios){
        boundary.user={...boundary.user,id:scenario.id??v.chief,role:scenario.role??"CHIEF"};
        const read=async()=>{const value=await scenario.read();scenario.check(value);return value;};
        const first=await observation.measure(read);expect(first.error).toBeUndefined();expect(observationGaps(first.sample,requiresTransaction(scenario.name))).toEqual([]);
        for(let warm=0;warm<5;warm++)await read();
        for(const concurrency of [1,5,10]){
          const samples:Sample[]=[];const started=performance.now(),memoryBefore=process.memoryUsage().heapUsed;
          await runLoad(100,concurrency,()=>observation!.measure(read),(result)=>{samples.push(result.sample);});
          const summary=summarize(samples);
          const incompleteInstrumentation=samples.filter((sample)=>observationGaps(sample,requiresTransaction(scenario.name)).length>0).length;
          reports.push({incompleteInstrumentation,scenario:scenario.name,concurrency,first:first.sample,...summary,throughput:100/((performance.now()-started)/1000),heapBefore:memoryBefore,heapAfter:process.memoryUsage().heapUsed});
          // Report all scenarios before enforcing timing gates; no errors/messages or SQL values printed.
        }
      }
      boundary.user={...boundary.user,id:v.chief,role:"CHIEF"};
      if(fixture.villages.length>1)await expect(getChiefFundReport(fixture.villages[1].active)).rejects.toThrow();
      boundary.user={...boundary.user,id:v.payer,role:"VILLAGER"};await expect(getChiefFundReconciliation(v.active)).rejects.toThrow();
      expect(sandbox.db.pool.waitingCount).toBe(0);
      expect(sandbox.db.pool.idleCount).toBe(sandbox.db.pool.totalCount);
      const version=await sandbox.db.pool.query<{version:string}>("SELECT version() AS version");
      console.log(JSON.stringify({kind:"phase7-performance",fixtureRun:fixture.run,profile:fixture.profile,inheritedVillageAudits:baseline,syntheticVillageAudits:syntheticIds.size,cardinalities,people:fixture.people,households:fixture.households,history,rows,combined,postgres:version.rows[0].version,node:process.version,prisma:(await import("@prisma/client")).Prisma.prismaVersion.client,reference:process.env.VFC_PERF_REFERENCE??"UNRECORDED",revision:process.env.VFC_PERF_REVISION??"UNRECORDED",treeHash:process.env.VFC_PERF_TREE_SHA256??"UNRECORDED",processPeakRssKb:process.resourceUsage().maxRSS,poolMax:sandbox.db.pool.options.max,reports}));
      if(process.env.VFC_PERF_EXPLAIN==="1"){
        // Only captured SELECTs, parameterized, on this owned child. Plans may
        // contain synthetic IDs; never use this observer against real-user data.
        const statements=[...observation.statements.values()];
        observation.dispose();
        for(const statement of statements) {
          const plan=await sandbox.db.pool.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement.text}`,statement.values);
          console.log(JSON.stringify({kind:"phase7-query-plan",shape:createHash("sha256").update(statement.text).digest("hex"),plan:plan.rows}));
        }
      }
      for(const item of reports as {scenario:string;p95:number;transactionP99:number|null;acquisitionP95:number|null;errors:number;maxSql:number;incompleteInstrumentation:number}[]){
        expect(item.incompleteInstrumentation,`${item.scenario}: incomplete instrumentation`).toBe(0);
        expect(item.maxSql,`${item.scenario}: SQL observation missing`).toBeGreaterThan(0);
        if(requiresTransaction(item.scenario))expect(item.transactionP99,`${item.scenario}: transaction observation missing`).not.toBeNull();
        expect(item.errors,`${item.scenario}: request errors`).toBe(0);
        expect(item.p95,`${item.scenario}: p95`).toBeLessThanOrEqual(/report|reconciliation/.test(item.scenario)?2000:1000);
        if(item.transactionP99!==null)expect(item.transactionP99).toBeLessThanOrEqual(3000);
        if(item.acquisitionP95!==null)expect(item.acquisitionP95).toBeLessThanOrEqual(250);
      }
    } catch(error){failures.push(error);}
    finally {observation?.dispose();boundary.client=null;try{await sandbox.dispose();}catch(error){failures.push(error);}}
    if(failures.length)throw new AggregateError(failures,"Performance run or owned-branch cleanup failed");
  },3_600_000);
});
