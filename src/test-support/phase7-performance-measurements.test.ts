import { expect,it } from "vitest";
import { percentile,runLoad,summarize,type Sample } from "./phase7-performance-measurements";
import { fixtureShape } from "./phase7-performance-fixtures";
import { parseFinancialDateRange } from "@/lib/financial-date-range";

it("keeps the empty platform-audit day within PostgreSQL-safe AD years with exact Yangon boundaries",()=>{
  const range=parseFinancialDateRange("2099-01-01","2099-01-01");
  expect(range.ok).toBe(true);
  if(!range.ok || !range.gte || !range.lt) throw new Error("Expected a valid bounded Yangon calendar day");
  expect(range.from).toBe("2099-01-01");expect(range.to).toBe("2099-01-01");
  expect(range.gte.toISOString()).toBe("2098-12-31T17:30:00.000Z");
  expect(range.lt.toISOString()).toBe("2099-01-01T17:30:00.000Z");
  expect(range.gte.getUTCFullYear()).toBeGreaterThan(0);
  expect(range.lt.getUTCFullYear()).toBeGreaterThan(0);
  expect(range.lt.getTime()-range.gte.getTime()).toBe(86_400_000);
});

it("computes nearest-rank percentiles without mutating input",()=>{const values=[4,1,3,2];expect(percentile(values,.5)).toBe(2);expect(percentile(values,.95)).toBe(4);expect(values).toEqual([4,1,3,2]);expect(()=>percentile([], .5)).toThrow();});
it("counts failures separately from latency and reports absent transaction observations",()=>{
  const base:Sample={ms:12,sql:2,sqlMs:4,maxParameters:10,rows:3,acquireMs:[],transactionMs:[],bytes:4,error:false};
  expect(summarize([base,{...base,error:true,ms:30}])).toMatchObject({requests:2,errors:1,p95:30,transactionP99:null,acquisitionP95:null,maxParameters:10});
});
it("uses the approved synthetic population and household profiles",()=>{
  for(const [profile,houses] of [["primary",600],["comparison",500]] as const){const shape=fixtureShape(profile);expect(shape).toHaveLength(10);expect(shape.reduce((n,v)=>n+v.people,0)).toBe(2000);expect(shape.reduce((n,v)=>n+v.houses,0)).toBe(houses);expect(shape.every((v)=>v.history===24)).toBe(true);}
  expect(fixtureShape("concentrated").reduce((n,v)=>n+v.people,0)).toBe(2000);
  expect(()=>fixtureShape("primary",0)).toThrow();expect(()=>fixtureShape("boundary",24,10002)).toThrow();
});
it("runs exactly the requested workload with bounded concurrency",async()=>{let active=0,max=0,calls=0;await runLoad(17,3,async()=>{active++;max=Math.max(max,active);await Promise.resolve();active--;return ++calls;},()=>{});expect(calls).toBe(17);expect(max).toBeLessThanOrEqual(3);});

it("observes callback and promise SQL without changing results/errors and restores methods",async()=>{
  const { EventEmitter }=await import("node:events");
  const { observePool }=await import("./phase7-performance-measurements");
  const failure=new Error("synthetic");
  const client={query(...args:unknown[]){const error=args[0]==="SELECT fail"?failure:null;const result={rows:[{n:1}],rowCount:1};const cb=args[args.length-1];if(typeof cb==="function"){queueMicrotask(()=>cb(error,result));return;}return error?Promise.reject(error):Promise.resolve(result);}};
  const originalQuery=client.query;
  const emitter=new EventEmitter();
  const pool=Object.assign(emitter,{connect(...args:unknown[]){emitter.emit("acquire",client);const cb=args[args.length-1];if(typeof cb==="function"){queueMicrotask(()=>cb(null,client));return;}return Promise.resolve(client);}});
  const originalConnect=pool.connect;
  const observation=observePool(pool as unknown as import("pg").Pool);
  try{
    const promise=await observation.measure(async()=>{const c=await pool.connect();return c!.query("SELECT 1",[1]);});
    expect(promise.value).toMatchObject({rowCount:1});expect(promise.sample.sql).toBe(1);expect(promise.sample.maxParameters).toBe(1);
    const callback=await observation.measure(()=>new Promise((resolve,reject)=>{pool.connect((error:unknown,c:typeof client)=>{if(error)return reject(error);c.query("SELECT 1",(err:unknown,value:unknown)=>err?reject(err):resolve(value));});}));
    expect(callback.sample.sql).toBe(1);expect(callback.error).toBeUndefined();
    const bad=await observation.measure(()=>Promise.resolve(client.query("SELECT fail")));expect(bad.error).toBe(failure);expect(bad.sample.error).toBe(true);
  }finally{observation.dispose();}
  expect(client.query).toBe(originalQuery);expect(pool.connect).toBe(originalConnect);
});

it("restores B's queued callback context when A dispatches it, preserving receiver, arguments and return",async()=>{
  const {EventEmitter}=await import("node:events");
  const {observePool}=await import("./phase7-performance-measurements");
  const client={query(_sql:string,values:unknown[]){return Promise.resolve({rowCount:values.length+1});}};
  type Callback=(this:object,error:null,connection:typeof client,release:()=>void)=>unknown;
  let queued:Callback|undefined;
  const receiver={pool:"synthetic"}, release=()=>{};
  let registered!:()=>void;
  const ready=new Promise<void>((resolve)=>{registered=resolve;});
  const emitter=new EventEmitter();
  const pool=Object.assign(emitter,{connect(callback:Callback){queued=callback;registered();}});
  const observer=observePool(pool as unknown as import("pg").Pool);
  try {
    const b=observer.measure(()=>new Promise((resolve,reject)=>{
      pool.connect(function(error,c,actualRelease){
        try{expect(this).toBe(receiver);expect(error).toBeNull();expect(actualRelease).toBe(release);
          c.query("SELECT B",[1,2]).then(resolve,reject);
        }catch(failure){reject(failure);}
        return "B callback result";
      });
    }));
    await ready;
    const a=await observer.measure(async()=>{
      emitter.emit("acquire",client);
      expect(queued!.call(receiver,null,client,release)).toBe("B callback result");
      return client.query("SELECT A",[1]);
    });
    const completedB=await b;
    expect(a.error).toBeUndefined();expect(completedB.error).toBeUndefined();
    expect(a.sample).toMatchObject({sql:1,maxParameters:1,rows:2});
    expect(completedB.sample).toMatchObject({sql:1,maxParameters:2,rows:3});
    const frozenA=structuredClone(a.sample),frozenB=structuredClone(completedB.sample);
    await client.query("SELECT outside",[1,2,3]);
    expect(a.sample).toEqual(frozenA);expect(completedB.sample).toEqual(frozenB);
  }finally{observer.dispose();}
});

it("reports missing per-request observations even when another request has SQL",async()=>{
  const {observationGaps}=await import("./phase7-performance-measurements");
  const valid:Sample={ms:1,sql:3,sqlMs:1,maxParameters:1,rows:1,acquireMs:[1],transactionMs:[1],bytes:1,error:false};
  const missing={...valid,sql:0,acquireMs:[],transactionMs:[]};
  expect(summarize([valid,missing]).maxSql).toBe(3);
  expect([valid,missing].map((sample)=>observationGaps(sample,true))).toEqual([[],["SQL","acquisition","transaction"]]);
  expect(observationGaps({...valid,transactionMs:[]},false)).toEqual([]);
});

it("requires the full migration trigger chain before the fixture write callback",async()=>{
  const {requireFinancialGuards,REQUIRED_FINANCIAL_TRIGGERS}=await import("./phase7-performance-fixtures");
  const valid=REQUIRED_FINANCIAL_TRIGGERS.map((row)=>({...row,tgenabled:"O"}));
  let writes=0;
  const preflightThenWrite=(rows:typeof valid)=>{requireFinancialGuards(rows,"origin");writes++;};
  for(const [table,name] of [["AuditLog","vfc_audit_guard"],["Payment","vfc_10_enqueue"],["House","vfc_00_scope"],["Village","vfc_00_bootstrap"]]) {
    expect(()=>preflightThenWrite(valid.filter((row)=>row.table_name!==table||row.tgname!==name))).toThrow();
  }
  for(const change of [{tgenabled:"D"},{tgenabled:"R"},{table_name:"Wrong"},{tgtype:31},{function_name:"wrong"},{function_schema:"wrong"},{tgdeferrable:true},{tginitdeferred:true},{tgnargs:1},{unconditional:false}]) {
    expect(()=>preflightThenWrite(valid.map((row,index)=>index===0?{...row,...change}:row))).toThrow();
  }
  expect(()=>requireFinancialGuards(valid,"replica")).toThrow();
  expect(writes).toBe(0);
  preflightThenWrite(valid);expect(writes).toBe(1);
  expect(()=>requireFinancialGuards(valid.map((row)=>({...row,tgenabled:"A"})),"origin")).not.toThrow();
});

it.each([9999,10000,10001])("specifies independent boundary completeness for %i rows",async(rows)=>{
  const {expectedBoundaryOutcome}=await import("./phase7-performance-fixtures");
  const outcome=expectedBoundaryOutcome({assessments:rows,payments:rows,receipts:rows,lifecycle:rows,audit:6*rows-1});
  if(rows<=10000){
    expect(outcome).toEqual({checks:{assessments:"PASS",payments:"PASS",receipts:"PASS",lifecycle:"PASS",audit:"UNVERIFIED"},incomplete:["audit:audit"],metricsAvailable:true});
  }else{
    expect(outcome.checks).toEqual({assessments:"UNVERIFIED",payments:"UNVERIFIED",receipts:"UNVERIFIED",lifecycle:"UNVERIFIED",audit:"UNVERIFIED"});
    expect(outcome.metricsAvailable).toBe(false);
    expect(outcome.incomplete).toEqual(["assessments:assessments","audit:assessments","audit:audit","audit:lifecycle","audit:payments","audit:receipts","lifecycle:assessments","lifecycle:lifecycle","lifecycle:payments","payments:assessments","payments:payments","receipts:payments","receipts:receipts"]);
  }
  const assessmentOnly=expectedBoundaryOutcome({assessments:rows,payments:0,receipts:0,lifecycle:1,audit:3});
  expect(assessmentOnly.checks.receipts).toBe("PASS");
  expect(assessmentOnly.metricsAvailable).toBe(rows<=10000);
});

it("appends a bounded village workload through the actual audit service and propagates write failure",async()=>{
  const {recordSyntheticVillageAudit}=await import("./phase7-performance-fixtures");
  const {vi}=await import("vitest");
  let next=0;
  const create=vi.fn().mockImplementation(async()=>({id:`synthetic-${++next}`}));
  const tx={auditLog:{create}};
  const db={prisma:{$transaction:async(body:(client:typeof tx)=>Promise<unknown>)=>body(tx)}} as unknown as import("./test-database").TestDatabase;
  const ids=await recordSyntheticVillageAudit(db,"fixture-village","fixture-chief","fixture-run");
  expect(ids).toHaveLength(25);expect(new Set(ids).size).toBe(25);expect(create).toHaveBeenCalledTimes(25);
  for(const [index,[input]] of create.mock.calls.entries()) {
    expect(input.data).toMatchObject({entityType:"VILLAGE",entityId:"fixture-village",villageId:"fixture-village",actorUserId:"fixture-chief",fundId:null,actionType:index===0?"CREATE":"UPDATE",metadata:{fixtureRun:"fixture-run",annotation:index}});
  }
  const error=new Error("guard rejected synthetic event");create.mockRejectedValueOnce(error);
  await expect(recordSyntheticVillageAudit(db,"fixture-village","fixture-chief","fixture-run")).rejects.toBe(error);
});
