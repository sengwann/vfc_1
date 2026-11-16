/** Mocked lifecycle tests only; no claim about PostgreSQL. */
import { beforeEach, afterEach, it, expect, vi } from "vitest";
const m=vi.hoisted(()=>({start:vi.fn(),connect:vi.fn(),query:vi.fn(),end:vi.fn(),dispose:vi.fn(),fresh:vi.fn(),handoff:vi.fn()}));
vi.mock("./report-postgres-sandbox",()=>({startReportPostgresSandbox:m.start}));
vi.mock("pg",()=>({Client:class{connect=m.connect;query=m.query;end=m.end;}}));
import { withReleaseDatabase,requireReleaseOptIns } from "./phase7-release-sandbox";
const base="postgresql://role:secret@ep-child.us-east-2.aws.neon.tech/vfc_test?sslmode=verify-full&application_name=vfc-report-unit";
beforeEach(()=>{
  vi.resetAllMocks();
  vi.stubGlobal("fetch",vi.fn(()=>{throw new Error("Unexpected real network call");}));
  for(const [key,value]of Object.entries({VFC_RUN_PHASE7_RELEASE:"1",VFC_RUN_REPORT_POSTGRES_TESTS:"1",TEST_DATABASE_ALLOW_REMOTE:"1",VFC_ALLOW_MIGRATION_TESTS:"1",NODE_ENV:"test"}))vi.stubEnv(key,value);
  m.query.mockResolvedValue({rows:[{database:"vfc_test",role:"role",application:"vfc-report-unit"}]});
  m.handoff.mockImplementation(async run=>run(base));
  m.fresh.mockResolvedValue(base.replace("/vfc_test?","/vfc_test_"+"a".repeat(32)+"?"));
  m.start.mockResolvedValue({withConnection:m.handoff,createEmptyDatabase:m.fresh,applicationName:"vfc-report-unit",dispose:m.dispose});
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it.each(["VFC_RUN_PHASE7_RELEASE","VFC_RUN_REPORT_POSTGRES_TESTS","TEST_DATABASE_ALLOW_REMOTE"])("refuses missing %s before provisioning",async key=>{
  vi.stubEnv(key,"");await expect(withReleaseDatabase("migrated",vi.fn())).rejects.toThrow();expect(m.start).not.toHaveBeenCalled();
});
it("does not implicitly enable migration or role modes",()=>{
  vi.stubEnv("VFC_ALLOW_MIGRATION_TESTS","");expect(()=>requireReleaseOptIns("fresh")).toThrow();expect(()=>requireReleaseOptIns("migrated")).not.toThrow();
});
it("closes SQL before owned branch disposal even after callback failure",async()=>{
  const failure=new Error("fixture failure");await expect(withReleaseDatabase("migrated",async()=>{throw failure;})).rejects.toBeInstanceOf(AggregateError);
  expect(m.end.mock.invocationCallOrder[0]).toBeLessThan(m.dispose.mock.invocationCallOrder[0]);
});
it("refuses a fresh target with a different endpoint",async()=>{
  m.fresh.mockResolvedValue(base.replace("ep-child","ep-parent"));const run=vi.fn();
  await expect(withReleaseDatabase("fresh",run)).rejects.toThrow();expect(m.connect).not.toHaveBeenCalled();expect(run).not.toHaveBeenCalled();expect(m.dispose).toHaveBeenCalled();
});
it("validates fresh database server identity",async()=>{
  m.query.mockResolvedValue({rows:[{database:"vfc_test_"+"a".repeat(32),role:"role",application:"vfc-report-unit"}]});
  const result=await withReleaseDatabase("fresh",async()=>42);expect(result).toBe(42);expect(m.fresh).toHaveBeenCalledOnce();
});
it("fails on handshake mismatch and on cleanup failure",async()=>{
  m.query.mockResolvedValue({rows:[{database:"parent",role:"role",application:"vfc-report-unit"}]});m.end.mockRejectedValue(new Error("close failed"));
  await expect(withReleaseDatabase("migrated",vi.fn())).rejects.toBeInstanceOf(AggregateError);expect(m.dispose).toHaveBeenCalledOnce();
});

it("near-limit provisioning remains owned and blocks the lifecycle drain until disposal completes",async()=>{
  const {drainReleaseLifecycles}=await import("./phase7-release-sandbox");
  let ready!:()=>void,closed!:()=>void;
  const provisioning=new Promise<void>(resolve=>{ready=resolve;}),closing=new Promise<void>(resolve=>{closed=resolve;});
  const original=m.start.getMockImplementation()!;
  m.start.mockImplementation(async()=>{await provisioning;return original();});
  m.dispose.mockImplementation(()=>closing);
  const body=new Error("body failed");
  const operation=withReleaseDatabase("migrated",async()=>{throw body;});
  const observed=operation.catch(error=>error);let drained=false;
  const drain=drainReleaseLifecycles().catch(error=>error).then(result=>{drained=true;return result;});
  await Promise.resolve();expect(drained).toBe(false);
  ready();await new Promise<void>(resolve=>setTimeout(resolve,0));expect(drained).toBe(false);
  closed();const error=await observed;expect(error.errors).toContain(body);await drain;expect(drained).toBe(true);
});
it("preserves original body and disposal failures together",async()=>{
  const body=new Error("body"),cleanup=new Error("cleanup");m.dispose.mockRejectedValue(cleanup);
  await expect(withReleaseDatabase("migrated",async()=>{throw body;})).rejects.toMatchObject({errors:[body,cleanup]});
});
it("provisioning failure never starts the body and remains observed",async()=>{
  const error=new Error("provisioning failed");m.start.mockRejectedValue(error);const body=vi.fn();
  await expect(withReleaseDatabase("migrated",body)).rejects.toBe(error);expect(body).not.toHaveBeenCalled();
});
it("delayed provisioning near readiness limit is awaited before entering the body",async()=>{
  vi.useFakeTimers();let ready!:()=>void;const hold=new Promise<void>(resolve=>{ready=resolve;});
  const implementation=m.start.getMockImplementation()!;m.start.mockImplementation(async()=>{await hold;return implementation();});
  const body=vi.fn(async()=>7);const result=withReleaseDatabase("migrated",body);
  try{await vi.advanceTimersByTimeAsync(59000);expect(body).not.toHaveBeenCalled();ready();expect(await result).toBe(7);expect(m.dispose).toHaveBeenCalledOnce();}
  finally{ready();vi.useRealTimers();}
});

it("release setup imports only the dependency-free shared registry, not the adapter",async()=>{
  const {readFile}=await import("node:fs/promises");
  const registry=await readFile("src/test-support/phase7-release-registry.ts","utf8");
  expect(registry).not.toMatch(/^import\s/m);
  const setup=await readFile("src/test-support/phase7-release-lifecycle.ts","utf8");
  expect(setup.match(/from ".\/phase7-release-[^"]+"/g)).toEqual(['from "./phase7-release-registry"']);
  const config=(await import("../../vitest.release.config")).default;
  expect(config.test?.setupFiles).toEqual(["./src/test-support/phase7-release-lifecycle.ts"]);
  const registryModule=await import("./phase7-release-registry");
  const adapter=await import("./phase7-release-sandbox");
  expect(adapter.drainReleaseLifecycles).toBe(registryModule.drainReleaseLifecycles);
  expect(await withReleaseDatabase("migrated",async()=>19)).toBe(19);
  expect(m.start).toHaveBeenCalledOnce();expect(m.dispose).toHaveBeenCalledOnce();expect(fetch).not.toHaveBeenCalled();
});
it("registers synchronously and owns late report setup through teardown after an earlier hook error",async()=>{
  const {trackReleaseLifecycle,finishReleaseSetup,drainReleaseLifecycles}=await import("./phase7-release-registry");
  vi.useFakeTimers();let ready!:()=>void,close!:()=>void;
  const pending=new Promise<void>(resolve=>{ready=resolve;}),closing=new Promise<void>(resolve=>{close=resolve;});
  let resource: {dispose:()=>Promise<void>}|undefined,started=false,finished=false;
  const setup=trackReleaseLifecycle(async()=>{started=true;await pending;resource={dispose:()=>closing};});
  expect(started).toBe(false); // Registry owns it before provisioning is invoked.
  const teardown=trackReleaseLifecycle(()=>finishReleaseSetup(setup,async()=>{await resource?.dispose();finished=true;}));
  let drained=false;const drain=drainReleaseLifecycles().then(()=>{drained=true;});
  try{
    const earlierHookError=new Error("simulated runner hook failure");
    // Simulate a runner ceasing to await setup without cancelling its work.
    const reportedHook=Promise.race([setup,Promise.reject(earlierHookError)]);
    await expect(reportedHook).rejects.toBe(earlierHookError);
    await vi.advanceTimersByTimeAsync(300001);expect(drained).toBe(false);expect(finished).toBe(false);
    ready();await vi.advanceTimersByTimeAsync(0);expect(resource).toBeDefined();expect(drained).toBe(false);
    close();await teardown;await drain;expect(finished).toBe(true);expect(drained).toBe(true);
  }finally{ready();close();await setup;await teardown;vi.useRealTimers();}
});
it.each([false,true])("report setup failure still awaits cleanup and preserves both failures=%s",async cleanupFails=>{
  const {trackReleaseLifecycle,finishReleaseSetup}=await import("./phase7-release-registry");
  const original=new Error("setup failed"),cleanup=new Error("cleanup failed");
  const setup=trackReleaseLifecycle(async()=>{throw original;});
  const dispose=vi.fn(async()=>{if(cleanupFails)throw cleanup;});
  await expect(finishReleaseSetup(setup,dispose)).rejects.toMatchObject({errors:cleanupFails?[original,cleanup]:[original]});
  expect(dispose).toHaveBeenCalledOnce();
});

it("new registry import after reset drains the exact pending operation from the old import",async()=>{
  const original=await import("./phase7-release-registry");
  let settle!:()=>void;const pending=new Promise<void>(resolve=>{settle=resolve;});
  const operation=original.trackReleaseLifecycle(()=>pending);
  let drained=false;let drain:Promise<void>|undefined;
  try{
    // Supported Vitest module-cache reset; never clear the Symbol.for global.
    vi.resetModules();
    const fresh=await import("./phase7-release-registry");
    expect(fresh.trackReleaseLifecycle).not.toBe(original.trackReleaseLifecycle);
    drain=fresh.drainReleaseLifecycles().then(()=>{drained=true;});
    await Promise.resolve();await Promise.resolve();expect(drained).toBe(false);
    settle();await operation;await drain;expect(drained).toBe(true);
    await original.drainReleaseLifecycles();await fresh.drainReleaseLifecycles();
  }finally{settle();await operation;await drain;}
});
