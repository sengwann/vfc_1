import { it,expect,vi } from "vitest";
const io=vi.hoisted(()=>({exec:vi.fn(),spawn:vi.fn(),start:vi.fn()}));
vi.mock("node:child_process",()=>({execFileSync:io.exec,spawn:io.spawn}));
vi.mock("./report-postgres-sandbox",()=>({startReportPostgresSandbox:io.start}));
import { checkMode,childEnvironment,account,executeAndDispose,main,suites,recoveryBreadcrumbs } from "../../scripts/phase7-release";
const enabled={VFC_RUN_PHASE7_RELEASE:"1",VFC_RUN_REPORT_POSTGRES_TESTS:"1",TEST_DATABASE_ALLOW_REMOTE:"1",NODE_ENV:"test"} satisfies NodeJS.ProcessEnv;
it("refuses release execution and unknown modes",()=>{
  expect(()=>checkMode("units",{NODE_ENV:"test"})).toThrow();expect(()=>checkMode("all",enabled)).toThrow();
});
it("keeps migration and role opt-ins independent",()=>{
  expect(()=>checkMode("integrity",enabled)).toThrow();expect(()=>checkMode("privileges",enabled)).toThrow();expect(()=>checkMode("reporting",enabled)).not.toThrow();
});
it("unit child receives no database credentials, Neon key or opt-ins",()=>{
  const env=childEnvironment("units",{...enabled,TEST_DATABASE_URL:"parent-secret",NEON_REPORT_API_KEY:"secret",DATABASE_URL:"production-secret"});
  expect(JSON.stringify(env)).not.toContain("secret");expect(env.TEST_DATABASE_URL).toBeUndefined();expect(env.VFC_RUN_REPORT_POSTGRES_TESTS).toBeUndefined();
});
it("database child uses only handed-off target and only mode-specific opt-ins",()=>{
  const url="postgresql://role:secret@ep-child.us-east-2.aws.neon.tech/vfc_test?sslmode=verify-full&application_name=vfc-report-abc";
  const env=childEnvironment("reporting",{...enabled,VFC_ALLOW_MIGRATION_TESTS:"1",VFC_ALLOW_ROLE_TESTS:"1",TEST_DATABASE_URL:"parent"},url);
  expect(env.TEST_DATABASE_URL).toBe(url);expect(env.VFC_ALLOW_ROLE_TESTS).toBeUndefined();expect(env.VFC_ALLOW_MIGRATION_TESTS).toBeUndefined();
  expect(()=>childEnvironment("reporting",enabled,"postgresql://parent.invalid/vfc_test")).toThrow();
});
it("allowlists exact suites and rejects failed, skipped or unexpected counts",()=>{
  expect(Object.values(suites).flat().every(p=>p.startsWith("src/")&&p.endsWith(".integration.test.ts")&&!p.includes("*"))).toBe(true);
  const report={numPassedTests:11,numFailedTests:0,numPendingTests:0,numTotalTests:11,success:true};
  expect(account(report,11,0).passed).toBe(11);
  for(const [change,expected,exit]of [[{numPendingTests:1},11,0],[{},10,0],[{},11,1],[{success:false},11,0]] as const)
    expect(()=>account({...report,...change},expected,exit)).toThrow();
});
it("awaits work and cleanup, reports both failures",async()=>{
  const order:string[]=[];await expect(executeAndDispose(async()=>{order.push("work");throw new Error("work");},async()=>{order.push("dispose");throw new Error("dispose");})).rejects.toMatchObject({errors:[expect.any(Error),expect.any(Error)]});expect(order).toEqual(["work","dispose"]);
});
it.each(["browser","historical","recovery"])("%s cannot become an automated PASS",async mode=>{
  vi.stubEnv("VFC_RUN_PHASE7_RELEASE","1");const log=vi.spyOn(console,"info").mockImplementation(()=>undefined);
  try{expect(await main(mode)).toBe(2);expect(log).toHaveBeenCalledWith(expect.stringContaining('"status":"NOT VERIFIED"'));}
  finally{log.mockRestore();vi.unstubAllEnvs();}
});

it("retains exact owned-run recovery identity without echoing driver secrets",()=>{
  const safe="Cleanup incomplete: project=test-project parent=br-parent branch=br-child name=vfc-report-abcd";
  expect(recoveryBreadcrumbs(`driver secret=password\n${safe}\npostgresql://private`)).toEqual([safe]);
});

it("unit configuration disables environment-file loading and omits every database key",async()=>{
  const config=(await import("../../vitest.release.config")).default;
  expect(config.envDir).toBe(false);
  expect(config.test?.hookTimeout).toBe(0);expect(config.test?.testTimeout).toBe(0);
  expect(config.test?.setupFiles).toEqual(["./src/test-support/phase7-release-lifecycle.ts"]);
  const result=childEnvironment("units",{NODE_ENV:"test",DATABASE_URL:"secret",DIRECT_URL:"secret",PGHOST:"secret",TEST_DATABASE_URL:"secret",NEON_REPORT_DB_PASSWORD:"secret",VFC_ALLOW_ROLE_TESTS:"1"});
  for(const key of ["DATABASE_URL","DIRECT_URL","PGHOST","TEST_DATABASE_URL","NEON_REPORT_DB_PASSWORD","VFC_ALLOW_ROLE_TESTS"])expect(Object.hasOwn(result,key)).toBe(false);
});
it("case evidence retains failed/skipped identities, redacts reasons and rejects equal-count changed cases",async()=>{
  const {collectCases}=await import("../../scripts/phase7-release");
  const file="src/example.test.ts",expected={sha:"a".repeat(40),mode:"units",files:[file],cases:[{file,name:"failed case",ordinal:0},{file,name:"skipped case",ordinal:1}]};
  const result=collectCases({success:false,testResults:[{name:process.cwd()+"/"+file,assertionResults:[{fullName:"failed case",status:"failed",failureMessages:["postgresql://private:password@host/db"]},{fullName:"skipped case",status:"pending",pendingReason:"token=secret"}]}]},expected);
  expect(result.valid).toBe(false);expect(result.cases.map(c=>c.name)).toEqual(["failed case","skipped case"]);expect(JSON.stringify(result)).not.toContain("secret");expect(JSON.stringify(result)).not.toContain("postgresql:");
  const different=collectCases({success:true,testResults:[{name:process.cwd()+"/"+file,assertionResults:[{fullName:"different",status:"passed"},{fullName:"skipped case",status:"passed"}]}]},expected);
  expect(different.valid).toBe(false);
  expect(()=>collectCases({},expected)).toThrow();
});
it("binds reviewed inventory bytes, revision and exact files",async()=>{
  const {validateInventory,digest}=await import("../../scripts/phase7-release");
  const file="src/example.test.ts",value={sha:"a".repeat(40),mode:"units",files:[file],cases:[{file,name:"case",ordinal:0}]},text=JSON.stringify(value);
  expect(validateInventory(text,digest(text),value.sha,"units",[file])).toEqual(value);
  expect(()=>validateInventory(text,"b".repeat(64),value.sha,"units",[file])).toThrow();
  expect(()=>validateInventory(text,digest(text),"c".repeat(40),"units",[file])).toThrow();
});
it("persists final BLOCKED evidence outside checkout without overwriting",async()=>{
  const {mkdtemp,readFile,rm}=await import("node:fs/promises"),{tmpdir}=await import("node:os"),{persistEvidence}=await import("../../scripts/phase7-release");
  const dir=await mkdtemp(tmpdir()+"/vfc-evidence-unit-");
  try{const value={runId:"run",sha:"a".repeat(40),status:"BLOCKED",exit:1,collection:"FAILED",cleanup:"FAILED",failures:["case failed","cleanup failed"]};
    const file=await persistEvidence(dir,"run",value);expect(JSON.parse(await readFile(file,"utf8"))).toEqual(value);
    await expect(persistEvidence(dir,"run",value)).rejects.toThrow();
  }finally{await rm(dir,{recursive:true,force:true});}
});

it.each(["nonzero","skipped","malformed","missing","cleanup","both","signal","inventory","raw-cleanup","publication","final-publication","create-failure","readback-mismatch","unsafe-temp","symlink-temp","success"])("writes SHA/run-bound durable evidence for %s",async scenario=>{
  const {mkdtemp,writeFile,readFile,readdir,rm}=await import("node:fs/promises"),{tmpdir}=await import("node:os"),{EventEmitter}=await import("node:events");
  const {digest}=await import("../../scripts/phase7-release");const dir=await mkdtemp(tmpdir()+"/vfc-runner-case-");
  const sha="a".repeat(40),files=[...suites.reporting];
  const expected={sha,mode:"reporting",files,cases:files.map(file=>({file,name:"case",ordinal:0}))};const text=JSON.stringify(expected),inventory=dir+"/inventory.json";
  await writeFile(inventory,text);io.exec.mockImplementation((_cmd:string,args:string[])=>args[0]==="rev-parse"?sha:args[0]==="branch"?"feature":"");
  const url="postgresql://role:secret@ep-child.us-east-2.aws.neon.tech/vfc_test?sslmode=verify-full&application_name=vfc-report-abc";
  io.start.mockResolvedValue({withConnection:async(run:(url:string)=>Promise<void>)=>run(url),dispose:async()=>{if(scenario==="cleanup"||scenario==="both")throw new Error("secret");}});
  io.spawn.mockImplementation((_exe:string,args:string[])=>{
    const child=new EventEmitter() as InstanceType<typeof EventEmitter>&{stdout:InstanceType<typeof EventEmitter>;stderr:InstanceType<typeof EventEmitter>};child.stdout=new EventEmitter();child.stderr=new EventEmitter();
    const output=args.find(arg=>arg.startsWith("--outputFile="))!.slice(13);
    void (async()=>{
      if(scenario!=="missing")await writeFile(output,scenario==="malformed"?"invalid JSON":JSON.stringify({success:scenario!=="nonzero"&&scenario!=="both",testResults:files.map(file=>({name:process.cwd()+"/"+file,assertionResults:[{fullName:"case",status:scenario==="skipped"?"pending":scenario==="both"?"failed":"passed",pendingReason:"token=secret"}]}))}));
      // Match a real child process: the runner attaches its listeners after spawn returns.
      queueMicrotask(() => {
        const exit = scenario === "nonzero" || scenario === "both" ? 1 : 0;
        const signal = scenario === "signal" ? "SIGTERM" : null;
        child.emit("close", signal ? null : exit, signal);
      });
    })();return child;
  });
  for(const[key,value]of Object.entries({...enabled,VFC_RELEASE_EVIDENCE_DIR:dir,VFC_RELEASE_REVISION:sha,VFC_RELEASE_EXPECTED_COUNTS:inventory,VFC_RELEASE_INVENTORY_SHA256:scenario==="inventory"?"b".repeat(64):digest(text)}))vi.stubEnv(key,value);
  const {evidenceIO}=await import("../../scripts/phase7-release");
  const log=vi.spyOn(console,"info").mockImplementation(()=>undefined);
  const errorLog=vi.spyOn(console,"error").mockImplementation(()=>undefined);
  const noRaw=scenario==="unsafe-temp"||scenario==="symlink-temp";
  const parentFault=noRaw?vi.spyOn(evidenceIO,"temporaryParent").mockReturnValue(scenario==="unsafe-temp"?process.cwd():dir+"/into-checkout"):undefined;
  if(scenario==="symlink-temp"){const fs=await import("node:fs/promises");await fs.symlink(process.cwd(),dir+"/into-checkout","dir");}
  const creation=vi.spyOn(evidenceIO,"mkdtemp");const spawned=io.spawn.mock.calls.length,provisioned=io.start.mock.calls.length;
  const fault=scenario==="create-failure"?vi.spyOn(evidenceIO,"open").mockRejectedValue(new Error("private open failure")):
    scenario==="readback-mismatch"?vi.spyOn(evidenceIO,"readFile").mockResolvedValue("private mismatched diagnostic"):
    scenario==="raw-cleanup"?vi.spyOn(evidenceIO,"rm").mockRejectedValue(new Error("private detail")):
    scenario==="publication"?vi.spyOn(evidenceIO,"link").mockRejectedValue(new Error("private detail")):
    scenario==="final-publication"?vi.spyOn(evidenceIO,"link").mockImplementation(async(a,b)=>{if(String(b).endsWith("-checkpoint.json")){const fs=await import("node:fs/promises");await fs.link(a,b);}else throw new Error("private detail");}):undefined;
  try{
    expect(await main("reporting")).toBe(scenario==="success"?0:1);
    if(noRaw){
      expect(creation).not.toHaveBeenCalled();expect(io.spawn.mock.calls).toHaveLength(spawned);expect(io.start.mock.calls).toHaveLength(provisioned);
      expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('"reason":"RAW_STORAGE_UNSAFE"'));
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain(process.cwd());
    }
    if(["publication","final-publication","create-failure","readback-mismatch"].includes(scenario)){
      expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('"reason":"DURABLE_PUBLICATION_FAILED"'));
      const message=JSON.parse(errorLog.mock.calls[0][0]);expect(message.sha).toBe(sha);expect(message.runId).toMatch(/^release-/);
      for(const text of ["private detail","private open failure","private mismatched diagnostic"])expect(JSON.stringify(errorLog.mock.calls)).not.toContain(text);
      expect(JSON.stringify(log.mock.calls)).not.toContain('"status":"PASS"');
      // Raw output remains private; locate it only in this mocked test for cleanup.
      const output=io.spawn.mock.calls.at(-1)?.[1].find((arg:string)=>arg.startsWith("--outputFile="))?.slice(13);
      if(output){const fs=await import("node:path");
        if(scenario!=="final-publication"){
          expect(JSON.parse(await readFile(output,"utf8"))).toHaveProperty("testResults");
          const fsPromises=await import("node:fs/promises");const privateDir=await fsPromises.realpath(fs.dirname(output));
          const {insideCheckout}=await import("../../scripts/phase7-release");expect(insideCheckout(await fsPromises.realpath(process.cwd()),privateDir)).toBe(false);
          expect((await fsPromises.stat(privateDir)).mode&0o777).toBe(0o700);
          expect(JSON.stringify([...log.mock.calls,...errorLog.mock.calls])).not.toContain(privateDir);
          expect((await readdir(dir)).some(name=>name.startsWith("release-"))).toBe(false);
        }
        else{await expect(readFile(output,"utf8")).rejects.toMatchObject({code:"ENOENT"});const checkpoint=(await readdir(dir)).find(file=>file.endsWith("-checkpoint.json"))!;expect(JSON.parse(await readFile(dir+"/"+checkpoint,"utf8"))).toMatchObject({status:"BLOCKED",publication:"RAW_REPORT_CLEANUP_PENDING"});}
        await rm(fs.dirname(output),{recursive:true,force:true});}
      return;
    }
    const artifact=(await readdir(dir)).find(file=>/^release-[a-f0-9-]+\.json$/.test(file))!;const saved=JSON.parse(await readFile(dir+"/"+artifact,"utf8"));
    expect(saved.publication).toBe("COMPLETE");expect(saved.command.join(" ")).not.toContain("-private-");expect(saved.sha).toBe(sha);expect(saved.runId).toMatch(/^release-/);expect(saved.status).toBe(scenario==="success"?"PASS":"BLOCKED");
    expect(saved.rawReport).toBe(scenario==="raw-cleanup"?"RETAINED_PRIVATE":scenario==="inventory"||noRaw?"NOT_CREATED":"REMOVED");
    expect(saved.cleanup).toBe(scenario==="inventory"||noRaw?"SETUP NOT RETURNED; inspect ownership breadcrumbs":scenario==="cleanup"||scenario==="both"?"FAILED":"COMPLETED");expect(JSON.stringify(saved)).not.toContain("token=secret");
    if (scenario === "missing") {
      expect(saved).toMatchObject({ exit: 0, signal: null, collection: "FAILED", status: "BLOCKED" });
    }
    if(scenario==="both")expect(saved.failures).toHaveLength(2);
  }finally{fault?.mockRestore();parentFault?.mockRestore();creation.mockRestore();log.mockRestore();errorLog.mockRestore();vi.unstubAllEnvs();
    if(scenario==="raw-cleanup"){const output=io.spawn.mock.calls.at(-1)?.[1].find((arg:string)=>arg.startsWith("--outputFile="))?.slice(13);if(output){const fs=await import("node:path");await rm(fs.dirname(output),{recursive:true,force:true});}}
    await rm(dir,{recursive:true,force:true});}
});

it.each([
  {status:"customer Alice password unconfigured",reason:"private"},
  {status:42,reason:{parameters:["Alice","different-password"]}},
  {status:"skipped",reason:"Alice Example; parameters=[123, 'private-name']; postgres://someone:other-password@host/db; Authorization Bearer other-token"},
  {status:"pending",reason:["SQL parameters", "other-secret"]},
  {status:"todo",reason:undefined},
  {status:"failed",reason:"credential not equal to configured secrets"},
])("retains only reviewed identities and controlled codes for $status",async({status,reason})=>{
  const {collectCases}=await import("../../scripts/phase7-release");
  const file="src/example.test.ts",expected={sha:"a".repeat(40),mode:"units",files:[file],cases:[{file,name:"reviewed case",ordinal:0}]};
  const result=collectCases({success:true,testResults:[{name:process.cwd()+"/"+file,private:{name:"Alice"},assertionResults:[{fullName:"reviewed case",status,pendingReason:reason,nested:{password:"other-password"},failureMessages:["Alice"]}]}]},expected);
  expect(result.valid).toBe(false);expect(result.cases[0].name).toBe("reviewed case");
  const text=JSON.stringify(result);for(const forbidden of ["Alice","parameters","private-name","other-password","other-token","other-secret","credential"])expect(text).not.toContain(forbidden);
  if(status===42||typeof status==="string"&&status.startsWith("customer")){
    expect(result.complete).toBe(false);expect(result.cases[0]).toMatchObject({status:"UNKNOWN_STATUS",reason:"COLLECTION_ERROR"});
  }else expect(result.cases[0].reason).toBe(status==="failed"?"ASSERTION_OR_EXECUTION_FAILED":"UNKNOWN_SKIP_REASON");
});
it("malformed case identity cannot leak text or pass collection",async()=>{
  const {collectCases}=await import("../../scripts/phase7-release");
  const file="src/example.test.ts",expected={sha:"a".repeat(40),mode:"units",files:[file],cases:[{file,name:"case",ordinal:0}]};
  for(const fullName of [null,{name:"Alice"},"Alice private diagnostic"]){
    const result=collectCases({success:true,testResults:[{name:process.cwd()+"/"+file,assertionResults:[{fullName,status:"passed"}]}]},expected);
    expect(result.complete).toBe(false);expect(result.valid).toBe(false);expect(JSON.stringify(result)).not.toContain("Alice");expect(result.cases[0].name).toBe("UNREVIEWED_CASE");
  }
});
it.each(["success","collision","create","write","file-sync","link","dir-sync","verify","mismatch"])("atomic artifact publication: %s",async scenario=>{
  const fs=await import("node:fs/promises"),{tmpdir}=await import("node:os");
  const {persistEvidence,evidenceIO}=await import("../../scripts/phase7-release");
  const dir=await fs.mkdtemp(tmpdir()+"/vfc-atomic-unit-"),final=dir+"/run.json";
  const value={runId:"run",sha:"a".repeat(40),status:"BLOCKED"};
  const faults: {mockRestore:()=>void}[]=[];const order:string[]=[];
  try{
    await fs.writeFile(dir+"/untouched.json","unrelated prior artifact");
    if(scenario==="collision"||scenario==="create")await fs.writeFile(final,"prior artifact");
    faults.push(vi.spyOn(evidenceIO,"open").mockImplementation(async(file,flags,mode)=>{
      if(scenario==="create"&&flags==="wx")throw new Error("private exclusive creation failure");
      const handle=await fs.open(file,flags,mode),directory=String(file)===dir;
      if(!directory){
        const write=handle.writeFile.bind(handle);
        faults.push(vi.spyOn(handle,"writeFile").mockImplementation(async(...args)=>{order.push("write");if(scenario==="write")throw new Error("private write failure");return write(...args);}));
      }
      const sync=handle.sync.bind(handle);
      faults.push(vi.spyOn(handle,"sync").mockImplementation(async()=>{order.push(directory?"dir-sync":"file-sync");if(scenario===(directory?"dir-sync":"file-sync"))throw new Error("private flush failure");await sync();}));
      return handle;
    }));
    faults.push(vi.spyOn(evidenceIO,"link").mockImplementation(async(a,b)=>{order.push("link");if(scenario==="link")throw new Error("private publication failure");await fs.link(a,b);}));
    if(scenario==="mismatch")faults.push(vi.spyOn(evidenceIO,"readFile").mockResolvedValue("different complete contents"));
    if(scenario==="verify")faults.push(vi.spyOn(evidenceIO,"readFile").mockRejectedValue(new Error("private read failure")));
    if(scenario==="success"){
      expect(await persistEvidence(dir,"run",value)).toBe(final);expect(JSON.parse(await fs.readFile(final,"utf8"))).toEqual(value);
      expect(order).toEqual(["write","file-sync","link","dir-sync"]);
    }else{
      await expect(persistEvidence(dir,"run",value)).rejects.toThrow("Evidence publication failed");
      if(scenario==="collision"||scenario==="create")expect(await fs.readFile(final,"utf8")).toBe("prior artifact");else await expect(fs.stat(final)).rejects.toMatchObject({code:"ENOENT"});
      if(scenario==="mismatch"){expect(order).toEqual(["write","file-sync","link"]);}
      if(scenario==="create")expect(order).toEqual([]);
    }
    expect(await fs.readFile(dir+"/untouched.json","utf8")).toBe("unrelated prior artifact");
    expect((await fs.readdir(dir)).some(name=>name.endsWith(".tmp"))).toBe(false);
  }finally{for(const fault of faults.reverse())fault.mockRestore();await fs.rm(dir,{recursive:true,force:true});}
});

it("canonical raw storage rejects nested/symlink parents and accepts private external sibling paths",async()=>{
  const fs=await import("node:fs/promises"),{tmpdir}=await import("node:os"),path=await import("node:path");
  const {createPrivateReportDirectory,insideCheckout,evidenceIO}=await import("../../scripts/phase7-release");
  const fixture=await fs.mkdtemp(path.join(tmpdir(),"vfc-raw-storage-unit-"));
  const checkout=path.join(fixture,"checkout"),nested=path.join(checkout,"nested"),external=path.join(fixture,"checkout-private");
  await fs.mkdir(nested,{recursive:true});await fs.mkdir(external);await fs.symlink(nested,path.join(fixture,"into-checkout"),"dir");
  const creation=vi.spyOn(evidenceIO,"mkdtemp");
  try{
    for(const parent of [checkout,nested,path.join(fixture,"into-checkout"),path.join(fixture,"missing")]){
      const count=creation.mock.calls.length;
      await expect(createPrivateReportDirectory("release-abcd",parent,checkout)).rejects.toThrow("RAW_STORAGE_UNSAFE");
      expect(creation.mock.calls).toHaveLength(count);
    }
    const folder=await createPrivateReportDirectory("release-abcd",external,checkout);
    const canonical=await fs.realpath(folder),root=await fs.realpath(checkout),stats=await fs.lstat(folder);
    expect(path.dirname(canonical)).toBe(await fs.realpath(external));expect(insideCheckout(root,canonical)).toBe(false);
    expect(stats.isDirectory()).toBe(true);expect(stats.isSymbolicLink()).toBe(false);expect(stats.mode&0o777).toBe(0o700);
    expect(stats.uid).toBe(process.getuid!());expect(path.basename(folder)).toMatch(/^release-abcd-private-/);
    const second=await createPrivateReportDirectory("release-abcd",external,checkout);expect(second).not.toBe(folder);
    expect(insideCheckout(root,root)).toBe(true);expect(insideCheckout(root,nested)).toBe(true);
    expect(insideCheckout(root,external)).toBe(false);expect(insideCheckout(root,path.dirname(root))).toBe(false);
  }finally{creation.mockRestore();await fs.rm(fixture,{recursive:true,force:true});}
});
it("unsafe post-creation metadata blocks storage and removes only the new empty directory",async()=>{
  const fs=await import("node:fs/promises"),{tmpdir}=await import("node:os");
  const {createPrivateReportDirectory,evidenceIO}=await import("../../scripts/phase7-release");
  const parent=await fs.mkdtemp(tmpdir()+"/vfc-private-metadata-");
  const permission=vi.spyOn(evidenceIO,"chmod").mockImplementation(async path=>{await fs.chmod(path,0o755);});
  try{await expect(createPrivateReportDirectory("release-abcd",parent)).rejects.toThrow("RAW_STORAGE_UNSAFE");expect(await fs.readdir(parent)).toEqual([]);}
  finally{permission.mockRestore();await fs.rm(parent,{recursive:true,force:true});}
});
it("inaccessible external parent fails closed before creating a private directory",async()=>{
  const fs=await import("node:fs/promises"),{tmpdir}=await import("node:os");
  const {createPrivateReportDirectory,evidenceIO}=await import("../../scripts/phase7-release");
  const parent=await fs.mkdtemp(tmpdir()+"/vfc-private-access-");
  const access=vi.spyOn(evidenceIO,"access").mockRejectedValue(new Error("private inaccessible path"));
  const create=vi.spyOn(evidenceIO,"mkdtemp");
  try{await expect(createPrivateReportDirectory("release-abcd",parent)).rejects.toThrow("RAW_STORAGE_UNSAFE");expect(create).not.toHaveBeenCalled();}
  finally{access.mockRestore();create.mockRestore();await fs.rm(parent,{recursive:true,force:true});}
});
