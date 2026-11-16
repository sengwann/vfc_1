import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import type { Pool, PoolClient } from "pg";

export interface Sample { ms: number; sql: number; sqlMs: number; maxParameters: number; rows: number; acquireMs: number[]; transactionMs: number[]; bytes: number; error: boolean }
export interface Statement { text: string; values: unknown[] }
interface Context { sample: Sample; starts: Map<PoolClient, number> }
export function percentile(values: number[], p: number): number {
  if (!values.length) throw new RangeError("No samples");
  if (!(p > 0 && p <= 1) || values.some((n) => !Number.isFinite(n) || n < 0)) throw new RangeError("Invalid percentile input");
  return [...values].sort((a,b)=>a-b)[Math.ceil(p*values.length)-1];
}
export function summarize(samples: Sample[]) {
  if (!samples.length) throw new RangeError("No samples");
  const times=samples.map((s)=>s.ms), tx=samples.flatMap((s)=>s.transactionMs), wait=samples.flatMap((s)=>s.acquireMs);
  return { requests:samples.length,errors:samples.filter((s)=>s.error).length,p50:percentile(times,.5),p95:percentile(times,.95),p99:percentile(times,.99),
    transactionP99:tx.length?percentile(tx,.99):null,acquisitionP95:wait.length?percentile(wait,.95):null,
    maxSql:Math.max(...samples.map((s)=>s.sql)),meanSqlMs:samples.reduce((n,s)=>n+s.sqlMs,0)/samples.length,maxSqlMs:Math.max(...samples.map((s)=>s.sqlMs)),maxParameters:Math.max(...samples.map((s)=>s.maxParameters)),maxRows:Math.max(...samples.map((s)=>s.rows)),maxBytes:Math.max(...samples.map((s)=>s.bytes)) };
}
/** Validate each request, rather than allowing another sample's SQL to mask gaps. */
export function observationGaps(sample: Sample, transactionRequired: boolean): string[] {
  return [
    ...(sample.sql > 0 ? [] : ["SQL"]),
    ...(sample.acquireMs.length ? [] : ["acquisition"]),
    ...(!transactionRequired || sample.transactionMs.length ? [] : ["transaction"]),
  ];
}
/** Test-process-only observation. Preserves callback and promise pg APIs; never
 * logs statement values or exception messages. Restores methods before disposal. */
export function observePool(pool: Pool) {
  const storage=new AsyncLocalStorage<Context | undefined>();
  const statements=new Map<string,Statement>();
  const restores: (()=>void)[]=[];
  const seen=new WeakSet<PoolClient>();
  type Fn=(...args:unknown[])=>unknown;
  function wrap(original: Fn, onStart:(args:unknown[])=>((error:unknown,value:unknown)=>void)): Fn {
    return function(this:unknown,...args:unknown[]) {
      const captured=storage.getStore();
      const done=onStart(args);let finished=false;
      const finish=(error:unknown,value:unknown)=>{if(!finished){finished=true;done(error,value);}};
      const last=args[args.length-1];
      if(typeof last === "function") args[args.length-1]=function(this:unknown,...cb:unknown[]){return storage.run(captured,()=>{finish(cb[0],cb[1]);return Reflect.apply(last,this,cb);});};
      try {
        const value=Reflect.apply(original,this,args);
        if(value && typeof (value as Promise<unknown>).then === "function") return (value as Promise<unknown>).then((result)=>{finish(null,result);return result;},(error:unknown)=>{finish(error,undefined);throw error;});
        return value;
      } catch(error){finish(error,undefined);throw error;}
    };
  }
  const install=(client:PoolClient)=>{
    if(seen.has(client)) return;seen.add(client);
    const original=client.query;
    client.query=wrap(original as unknown as Fn,(args)=>{
      const context=storage.getStore(),started=performance.now();
      const config=args[0] as {text?:unknown;values?:unknown[]};
      const text=typeof args[0]==="string"?args[0]:typeof config?.text==="string"?config.text:"";
      const values=Array.isArray(args[1])?args[1]:Array.isArray(config?.values)?config.values:[];
      if(context){context.sample.sql++;context.sample.maxParameters=Math.max(context.sample.maxParameters,values.length);
        if(/^\s*(BEGIN|START TRANSACTION)\b/i.test(text)) context.starts.set(client,started);
        // One representative parameter set per SQL shape; synthetic fixture data only.
        if(/^\s*SELECT\b/i.test(text) && !statements.has(text)) statements.set(text,{text,values:[...values]});
      }
      return (_error,result)=>{if(!context)return;context.sample.sqlMs+=performance.now()-started;
        const rows=(result as {rowCount?:number}|undefined)?.rowCount;context.sample.rows+=typeof rows==="number"&&rows>0?rows:0;
        if(/^\s*(COMMIT|ROLLBACK)\b/i.test(text)){const start=context.starts.get(client);if(start!==undefined)context.sample.transactionMs.push(performance.now()-start);context.starts.delete(client);}
      };
    }) as typeof client.query;
    restores.push(()=>{client.query=original;});
  };
  pool.on("acquire",install);
  const originalConnect=pool.connect;
  pool.connect=wrap(originalConnect as unknown as Fn,()=>{
    const context=storage.getStore(),start=performance.now();
    return (_error,result)=>{if(result)install(result as PoolClient);if(context)context.sample.acquireMs.push(performance.now()-start);};
  }) as typeof pool.connect;
  return {
    statements,
    async measure<T>(read:()=>Promise<T>):Promise<{sample:Sample;value?:T;error?:unknown}> {
      const sample:Sample={ms:0,sql:0,sqlMs:0,maxParameters:0,rows:0,acquireMs:[],transactionMs:[],bytes:0,error:false};
      return storage.run({sample,starts:new Map()},async()=>{const start=performance.now();try{const value=await read();sample.bytes=Buffer.byteLength(JSON.stringify(value)??"");return {sample,value};}catch(error){sample.error=true;return {sample,error};}finally{sample.ms=performance.now()-start;}});
    },
    dispose(){pool.connect=originalConnect;pool.off("acquire",install);for(const restore of restores)restore();statements.clear();},
  };
}
export async function runLoad<T>(count:number,concurrency:number,read:()=>Promise<T>,check:(value:T)=>void) {
  if(!Number.isInteger(count)||count<1||!Number.isInteger(concurrency)||concurrency<1||concurrency>10)throw new RangeError("Invalid load");
  let next=0;
  await Promise.all(Array.from({length:concurrency},async()=>{while(next++<count)check(await read());}));
}
