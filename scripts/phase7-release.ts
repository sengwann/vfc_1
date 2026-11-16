/** Preparation runner. Never deploys/publishes. Invoke only after execution approval. */
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, readdir, mkdir, realpath, open, link, unlink, chmod, lstat, access, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { startReportPostgresSandbox } from "../src/test-support/report-postgres-sandbox";
import { requireReleaseOptIns } from "../src/test-support/phase7-release-sandbox";

const fund = "src/features/fund-management/";
export const suites = {
  integrity: ["lib/fund-migration.integration.test.ts", "lib/fund-schema.integration.test.ts", "lib/fund-immutability.integration.test.ts"].map(p => fund + p),
  privileges: [fund + "lib/fund-runtime-security.integration.test.ts"],
  operations: [fund + "actions/fund-activation.integration.test.ts", fund + "actions/fund-completion.integration.test.ts",
    "src/features/cash-payment/actions/payment-authorization.integration.test.ts", "src/features/collector-assignment/actions/collector-authorization.integration.test.ts",
    "src/features/household-management/lib/household-write.integration.test.ts", "src/features/village-management/lib/village-financial-lifecycle.integration.test.ts",
    "src/lib/authz/transaction-authority.integration.test.ts", "src/lib/authz/village-write-guard.integration.test.ts"],
  concurrency: [fund + "lib/fund-concurrency.integration.test.ts", fund + "actions/fund-completion-concurrency.integration.test.ts",
    "src/features/cash-payment/actions/receipt-allocation.integration.test.ts", "src/lib/db/village-scope.integration.test.ts"],
  reporting: [fund + "lib/fund-report-queries.integration.test.ts", "src/test-support/phase7-release.integration.test.ts"],
} as const;
export type Mode = keyof typeof suites | "units" | "browser" | "historical" | "recovery";
export const manualModes = ["browser", "historical", "recovery"] as const;
export function checkMode(mode: string, env = process.env): asserts mode is Mode {
  if (env.VFC_RUN_PHASE7_RELEASE !== "1") throw new Error("Explicit release opt-in required");
  if (!(mode in suites) && mode !== "units" && !manualModes.some(m => m === mode)) throw new Error("Unknown release mode");
  if (mode in suites) {
    requireReleaseOptIns("migrated", env);
    if (["integrity", "operations", "concurrency"].includes(mode) && env.VFC_ALLOW_MIGRATION_TESTS !== "1") throw new Error("Migration opt-in required");
    if (mode === "privileges" && env.VFC_ALLOW_ROLE_TESTS !== "1") throw new Error("Role opt-in required");
  }
}
export function childEnvironment(mode: Mode, env: NodeJS.ProcessEnv, verified?: string): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "SYSTEMROOT", "SystemRoot", "LANG", "CI"]) if (env[key]) result[key] = env[key];
  result.NODE_ENV = "test";
  if (mode === "units") return result;
  result.DATABASE_URL = "postgresql://disabled:disabled@127.0.0.1:1/disabled";
  if (!verified) throw new Error("Verified child connection required");
  const url = new URL(verified);
  if (!/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(url.hostname) || url.hostname.includes("-pooler.") ||
      url.pathname !== "/vfc_test" || url.searchParams.get("sslmode") !== "verify-full" ||
      !/^vfc-report-[a-f0-9-]+$/.test(url.searchParams.get("application_name") ?? "")) throw new Error("Invalid child handoff");
  for (const key of ["NEON_REPORT_API_KEY", "NEON_REPORT_PROJECT_ID", "NEON_REPORT_PROJECT_NAME", "NEON_REPORT_PARENT_BRANCH_ID", "NEON_REPORT_PARENT_BRANCH_NAME", "NEON_REPORT_DB_ROLE", "NEON_REPORT_DB_PASSWORD", "VFC_RUN_PHASE7_RELEASE", "VFC_RUN_REPORT_POSTGRES_TESTS", "TEST_DATABASE_ALLOW_REMOTE"]) result[key] = env[key];
  result.TEST_DATABASE_URL = verified;
  if (["integrity", "operations", "concurrency"].includes(mode)) result.VFC_ALLOW_MIGRATION_TESTS = env.VFC_ALLOW_MIGRATION_TESTS;
  if (mode === "privileges") result.VFC_ALLOW_ROLE_TESTS = env.VFC_ALLOW_ROLE_TESTS;
  return result;
}
/** Only emit lifecycle identity breadcrumbs; never echo raw child output. */
export function recoveryBreadcrumbs(text: string): string[] {
  const matches = text.match(/(?:Creating report sandbox: project=[a-z0-9-]+ parent=br-[a-z0-9-]+ name=vfc-report-[a-f0-9-]+ requested_at=[0-9TZ:.-]+|Report sandbox created: project=[a-z0-9-]+ branch=br-[a-z0-9-]+ name=vfc-report-[a-f0-9-]+|Cleanup incomplete: project=[a-z0-9-]+ parent=br-[a-z0-9-]+ branch=[a-z0-9-]+ name=vfc-report-[a-f0-9-]+|Setup\/cleanup failed: project=[a-z0-9-]+ name=vfc-report-[a-f0-9-]+)/g);
  return [...new Set(matches ?? [])];
}
export interface Counts { passed: number; failed: number; skipped: number; total: number }
export function account(report: { numPassedTests: number; numFailedTests: number; numPendingTests: number; numTotalTests: number; success: boolean }, expected: number, exit: number): Counts {
  const counts = { passed: report.numPassedTests, failed: report.numFailedTests, skipped: report.numPendingTests, total: report.numTotalTests };
  if (!Number.isInteger(expected) || expected < 1 || exit !== 0 || !report.success || counts.failed || counts.skipped || counts.total !== expected || counts.passed !== expected)
    throw new Error(`Verification failed: expected=${expected} passed=${counts.passed} failed=${counts.failed} skipped=${counts.skipped} total=${counts.total} exit=${exit}`);
  return counts;
}
async function unitFiles(dir: string): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = `${dir}/${entry.name}`;
    if (entry.isDirectory()) paths.push(...await unitFiles(file));
    else if (entry.name.endsWith(".test.ts") && !entry.name.endsWith(".integration.test.ts")) paths.push(file);
  }
  return paths.sort();
}
export async function executeAndDispose<T>(work: () => Promise<T>, dispose: () => Promise<void>): Promise<T> {
  const errors: unknown[] = []; let value!: T;
  try { value = await work(); } catch (error) { errors.push(error); }
  try { await dispose(); } catch (error) { errors.push(error); }
  if (errors.length) throw new AggregateError(errors, "Release gate or sandbox cleanup failed");
  return value;
}
export type CaseIdentity = { file: string; name: string; ordinal: number };
export interface ExpectedInventory { sha: string; mode: string; files: string[]; cases: CaseIdentity[] }
export const digest=(value:string)=>createHash("sha256").update(value).digest("hex");
export function validateInventory(text:string, approvedHash:string, sha:string, mode:string, files:string[]): ExpectedInventory {
  if(!/^[a-f0-9]{64}$/.test(approvedHash)||digest(text)!==approvedHash)throw new Error("Expected inventory hash mismatch");
  const value=JSON.parse(text) as ExpectedInventory;
  if(value.sha!==sha||value.mode!==mode||JSON.stringify(value.files)!==JSON.stringify(files)||!Array.isArray(value.cases)||!value.cases.length||
    value.cases.some(c=>!files.includes(c.file)||typeof c.name!=="string"||!c.name.length||c.name.length>4096||!Number.isInteger(c.ordinal)||c.ordinal<0))throw new Error("Expected inventory revision/manifest mismatch");
  if(new Set(value.cases.map(c=>c.file)).size!==files.length)throw new Error("Expected inventory omits a suite");
  if(new Set(value.cases.map(c=>JSON.stringify(c))).size!==value.cases.length)throw new Error("Duplicate expected identity");
  return {sha,mode,files:[...files],cases:value.cases.map(({file,name,ordinal})=>({file,name,ordinal}))};
}
// Exact status values emitted by this repository's Vitest JSON reporter.
const reporterStatuses = ["passed", "failed", "pending", "skipped", "todo"] as const;
export function collectCases(raw: unknown, expected: ExpectedInventory) {
  const object = (value: unknown): Record<string, unknown> | undefined =>
    value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  const report = object(raw);
  if (!report || !Array.isArray(report.testResults)) throw new Error("COLLECTION_ERROR");
  let complete = true;
  const cases = report.testResults.flatMap(value => {
    const suite = object(value);
    if (!suite || typeof suite.name !== "string" || suite.name.length > 4096 || !Array.isArray(suite.assertionResults)) throw new Error("COLLECTION_ERROR");
    const file = path.relative(process.cwd(), suite.name).replaceAll("\\", "/");
    return suite.assertionResults.map((value, ordinal) => {
      const test = object(value);
      const identity = typeof test?.fullName === "string" && test.fullName.length > 0 && test.fullName.length <= 4096 ? test.fullName : undefined;
      const known = identity && expected.cases.find(c => c.file === file && c.name === identity && c.ordinal === ordinal);
      const supported = typeof test?.status === "string" && reporterStatuses.some(status => status === test.status);
      if (!known || !supported) complete = false;
      const status = supported ? test!.status as typeof reporterStatuses[number] : "UNKNOWN_STATUS";
      // Copy only reviewed identities and controlled codes. No diagnostic text,
      // nested fields, parameters, raw statuses, or unreviewed names are retained.
      return { file: expected.files.includes(file) ? file : "UNEXPECTED_SUITE",
        name: known ? known.name : "UNREVIEWED_CASE", ordinal, status,
        reason: !supported || !known ? "COLLECTION_ERROR" : status === "passed" ? null : status === "failed" ? "ASSERTION_OR_EXECUTION_FAILED" : "UNKNOWN_SKIP_REASON",
        reasonAvailable: Boolean(test && Object.hasOwn(test, "pendingReason")),
      };
    });
  });
  const actual = cases.map(({file,name,ordinal}) => ({file,name,ordinal}));
  const key = (c: CaseIdentity) => JSON.stringify(c);
  const matches = JSON.stringify(actual.map(key).sort()) === JSON.stringify(expected.cases.map(key).sort());
  return { cases, complete, valid: complete && report.success === true && matches && cases.every(c => c.status === "passed") };
}
// Injectable filesystem boundary for mocked failure tests; never used for DB work.
export const evidenceIO = { mkdir, realpath, open, link, unlink, readFile, chmod, rm,
  mkdtemp, lstat, access, rmdir, temporaryParent: () => tmpdir() };
/** Canonical path containment: sibling prefixes do not count as descendants. */
export function insideCheckout(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep));
}
class RawStorageError extends Error {
  constructor() { super("RAW_STORAGE_UNSAFE"); }
}
export async function createPrivateReportDirectory(runId: string, configuredParent = evidenceIO.temporaryParent(), checkout = process.cwd()): Promise<string> {
  let created: string | undefined;
  try {
    if (!/^release-[a-f0-9-]+$/.test(runId)) throw new RawStorageError();
    const root = await evidenceIO.realpath(checkout);
    const parent = await evidenceIO.realpath(configuredParent);
    if (insideCheckout(root, parent) || !(await evidenceIO.lstat(parent)).isDirectory()) throw new RawStorageError();
    // W_OK | X_OK: refuse inaccessible/non-writable parents before creation.
    await evidenceIO.access(parent, 2 | 1);
    created = await evidenceIO.mkdtemp(path.join(parent, `${runId}-private-`));
    const initial = await evidenceIO.lstat(created);
    if (!initial.isDirectory() || initial.isSymbolicLink() || typeof process.getuid !== "function" || initial.uid !== process.getuid()) throw new RawStorageError();
    await evidenceIO.chmod(created, 0o700);
    const canonical = await evidenceIO.realpath(created), actual = await evidenceIO.lstat(created);
    if (insideCheckout(root, canonical) || path.dirname(canonical) !== parent ||
        !path.basename(canonical).startsWith(`${runId}-private-`) ||
        !actual.isDirectory() || actual.isSymbolicLink() ||
        actual.dev !== initial.dev || actual.ino !== initial.ino ||
        (actual.mode & 0o777) !== 0o700 ||
        typeof process.getuid !== "function" || actual.uid !== process.getuid()) throw new RawStorageError();
    return canonical;
  } catch {
    // Only the new, still-empty mkdtemp directory is eligible for removal.
    // Never recursively remove a substituted path or print an unsafe raw path.
    if (created) try { await evidenceIO.rmdir(created); } catch {
      throw new AggregateError([new RawStorageError(),new Error("PRIVATE_DIRECTORY_CLEANUP_FAILED")],"RAW_STORAGE_UNSAFE");
    }
    throw new RawStorageError();
  }
}
export async function persistEvidence(directory: string, runId: string, evidence: unknown) {
  if (!/^[a-zA-Z0-9-]+$/.test(runId)) throw new Error("Invalid artifact identity");
  await evidenceIO.mkdir(directory, { recursive: true, mode: 0o700 });
  const root = await evidenceIO.realpath(process.cwd()), destination = await evidenceIO.realpath(directory);
  if (destination === root || destination.startsWith(root + path.sep)) throw new Error("Evidence must be outside checkout");
  const final = path.join(destination, `${runId}.json`);
  const temporary = path.join(destination, `.${runId}-${randomUUID()}.tmp`);
  const contents = JSON.stringify(evidence, null, 2);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let linked = false, created = false;
  const failures: unknown[] = [];
  try {
    handle = await evidenceIO.open(temporary, "wx", 0o600); created = true;
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close(); handle = undefined;
    // Same-filesystem hard link is atomic and refuses an existing destination.
    // No rename fallback: unsupported filesystems fail closed.
    await evidenceIO.link(temporary, final); linked = true;
    if (await evidenceIO.readFile(final, "utf8") !== contents) throw new Error("Artifact verification failed");
    await evidenceIO.unlink(temporary);
    const dir = await evidenceIO.open(destination, "r");
    try { await dir.sync(); } finally { await dir.close(); }
    return final;
  } catch {
    failures.push(new Error("ATOMIC_PUBLICATION_FAILED"));
    // Never remove a pre-existing artifact on a collision.
    if (linked) try { await evidenceIO.unlink(final); } catch { failures.push(new Error("PUBLICATION_ROLLBACK_FAILED")); }
  } finally {
    if (handle) try { await handle.close(); } catch { failures.push(new Error("TEMP_CLOSE_FAILED")); }
    if (created) try { await evidenceIO.unlink(temporary); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") failures.push(new Error("TEMP_CLEANUP_FAILED"));
    }
  }
  throw new AggregateError(failures, "Evidence publication failed; no completion was certified");
}
export async function main(mode: string) {
  checkMode(mode);
  if(manualModes.some(m=>m===mode)){
    console.info(JSON.stringify({mode,status:"NOT VERIFIED",procedure:"docs/phase7-release-verification.md"}));return 2;
  }
  const directory=process.env.VFC_RELEASE_EVIDENCE_DIR;
  if(!directory)throw new Error("Explicit external evidence directory required");
  const runId=`release-${randomUUID()}`,startedAt=new Date().toISOString();
  const sha=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
  const branch=execFileSync("git",["branch","--show-current"],{encoding:"utf8"}).trim();
  const tree=execFileSync("git",["status","--porcelain=v1"],{encoding:"utf8"});
  const files=mode==="units"?await unitFiles("src"):[...suites[mode as keyof typeof suites]];
  const manifestHash=digest(JSON.stringify(files));
  const evidence={runId,sha,branch,tree:tree?"DIRTY":"CLEAN",mode,startedAt,endedAt:"",manifestHash,inventoryHash:"",expected:null as ExpectedInventory|null,
    command:[] as string[],optIns:["VFC_RUN_PHASE7_RELEASE",...(mode==="units"?[]:["VFC_RUN_REPORT_POSTGRES_TESTS","TEST_DATABASE_ALLOW_REMOTE"]),...(["integrity","operations","concurrency"].includes(mode)?["VFC_ALLOW_MIGRATION_TESTS"]:[]),...(mode==="privileges"?["VFC_ALLOW_ROLE_TESTS"]:[])],
    counts:{expected:0,total:0,passed:0,failed:0,skipped:0},cases:[] as ReturnType<typeof collectCases>["cases"],exit:null as number|null,signal:null as string|null,collection:"NOT STARTED",cleanup:"NOT STARTED",ownership:[] as string[],rawReport:"NOT_CREATED",failures:[] as string[],status:"BLOCKED",limitations:["Raw database diagnostics withheld; browser/history/recovery remain separate manual gates"]};
  let sandbox:Awaited<ReturnType<typeof startReportPostgresSandbox>>|undefined;
  let folder:string|undefined;
  try{
    if(!/^[a-f0-9]{40}$/.test(process.env.VFC_RELEASE_REVISION??"")||sha!==process.env.VFC_RELEASE_REVISION||tree.trim())throw new Error("Revision/clean-tree gate failed");
    const text=await readFile(process.env.VFC_RELEASE_EXPECTED_COUNTS??"","utf8");evidence.inventoryHash=digest(text);
    evidence.expected=validateInventory(text,process.env.VFC_RELEASE_INVENTORY_SHA256??"",sha,mode,files);evidence.counts.expected=evidence.expected.cases.length;
    // Validate artifact location before any provisioning; final file is exclusive.
    await mkdir(directory,{recursive:true,mode:0o700});
    const dest=await realpath(directory),root=await realpath(process.cwd());if(dest===root||dest.startsWith(root+path.sep))throw new Error("Evidence inside checkout");
    folder=await createPrivateReportDirectory(runId);evidence.rawReport="RETAINED_PRIVATE";const output=path.join(folder,"vitest.json");
    const command=[process.execPath,"node_modules/vitest/vitest.mjs","run","--config","vitest.release.config.ts","--no-file-parallelism","--reporter=json",`--outputFile=${output}`,...files];
    evidence.command=command.map(arg=>arg.startsWith("--outputFile=")?"--outputFile=<PRIVATE_REPORT>":arg);
    const run=async(verified?:string)=>{
      await new Promise<void>((resolve,reject)=>{
        const child=spawn(command[0],command.slice(1),{env:childEnvironment(mode as Mode,process.env,verified),stdio:["ignore","pipe","pipe"]});
        for(const stream of [child.stdout,child.stderr]){let pending="";stream?.on("data",(chunk:Buffer)=>{pending+=chunk.toString();const lines=pending.split("\n");pending=lines.pop()!.slice(-4096);for(const line of lines)for(const item of recoveryBreadcrumbs(line)){evidence.ownership.push(item);console.info(item);}});stream?.on("end",()=>{evidence.ownership.push(...recoveryBreadcrumbs(pending));});}
        child.once("error",()=>{evidence.collection="LAUNCH FAILED";reject(new Error("Subprocess launch failed"));});
        child.once("close",(code,signal)=>{evidence.exit=code;evidence.signal=signal;resolve();});
      });
      evidence.collection="READING";
      const text=await readFile(output,"utf8");evidence.ownership.push(...recoveryBreadcrumbs(text));
      const parsed=collectCases(JSON.parse(text),evidence.expected!);evidence.cases=parsed.cases;evidence.collection=parsed.complete?"PARSED":"INCOMPLETE";
      evidence.counts={expected:evidence.expected!.cases.length,total:parsed.cases.length,passed:parsed.cases.filter(c=>c.status==="passed").length,failed:parsed.cases.filter(c=>c.status==="failed").length,skipped:parsed.cases.filter(c=>c.status!=="passed"&&c.status!=="failed").length};
      if(!parsed.valid||evidence.exit!==0||evidence.signal)throw new Error("Case inventory/status/exit gate failed");
    };
    if(mode==="units")await run();else {sandbox=await startReportPostgresSandbox();await sandbox.withConnection(async url=>{
      const verified=new URL(url);evidence.ownership.push(`owned application=${verified.searchParams.get("application_name")} endpoint=${verified.hostname} database=${verified.pathname.slice(1)}`);
      await run(url);
    });}
  }catch(error){
    if(error instanceof RawStorageError || error instanceof AggregateError && error.message === "RAW_STORAGE_UNSAFE") {
      evidence.failures.push("RAW_STORAGE_UNSAFE");
      const cleanupFailed=error instanceof AggregateError && error.errors.some(item=>item instanceof Error && item.message === "PRIVATE_DIRECTORY_CLEANUP_FAILED");
      if(cleanupFailed)evidence.failures.push("PRIVATE_DIRECTORY_CLEANUP_FAILED");
      console.error(JSON.stringify({runId,sha,status:"BLOCKED",reason:"RAW_STORAGE_UNSAFE",cleanup:cleanupFailed?"PRIVATE_DIRECTORY_CLEANUP_FAILED":"NO_RAW_REPORT_CREATED"}));
    }
    evidence.failures.push("Release execution, inventory or collection gate failed");if(evidence.collection==="READING")evidence.collection="FAILED";
    const visit=(value:unknown):void=>{if(value instanceof Error)evidence.ownership.push(...recoveryBreadcrumbs(value.message));if(value instanceof AggregateError)value.errors.forEach(visit);};visit(error);
  }finally{
    if(sandbox){try{await sandbox.dispose();evidence.cleanup="COMPLETED";}catch(error){evidence.cleanup="FAILED";evidence.failures.push("Owned sandbox cleanup failed");if(error instanceof Error)evidence.ownership.push(...recoveryBreadcrumbs(error.message));}}
    else evidence.cleanup=mode==="units"?"NOT APPLICABLE":"SETUP NOT RETURNED; inspect ownership breadcrumbs";
    evidence.endedAt=new Date().toISOString();
    try {
      // First publish a safe BLOCKED checkpoint. Raw diagnostics cannot be
      // removed until sanitized evidence exists. Only the final artifact is a gate.
      await persistEvidence(directory, `${runId}-checkpoint`, { ...evidence, status:"BLOCKED", publication:"RAW_REPORT_CLEANUP_PENDING" });
      if(folder)try{await evidenceIO.rm(folder,{recursive:true,force:true});evidence.rawReport="REMOVED";}catch{evidence.failures.push("PRIVATE_REPORT_CLEANUP_FAILED");}
      evidence.endedAt=new Date().toISOString();
      evidence.status=evidence.failures.length?"BLOCKED":"PASS";
      const artifact=await persistEvidence(directory,runId,{...evidence,publication:"COMPLETE"});
      console.info(JSON.stringify({runId,sha,mode,status:evidence.status,artifact,cleanup:evidence.cleanup}));
    } catch {
      evidence.status="BLOCKED";
      // No path or raw errors: private recovery is documented by run identity.
      console.error(JSON.stringify({runId,sha,mode,status:"BLOCKED",reason:"DURABLE_PUBLICATION_FAILED",recovery:"PRIVATE_RUN_RECOVERY_REQUIRED"}));
    }
  }
  return evidence.status==="PASS"?0:1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  main(process.argv[2]??"").then(code=>{process.exitCode=code;}).catch(()=>{console.error("Release gate BLOCKED; evidence prerequisites unavailable");process.exitCode=1;});
}
