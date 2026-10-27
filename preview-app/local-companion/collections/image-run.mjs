import { LEGACY_CONFIG_PATH } from "../runtime-paths.mjs";
import { spawn } from "node:child_process";
import { open, mkdir, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { durableFile } from "../handoff/repeatable-state.mjs";
import { bounded, hash, safeDirectory } from "../handoff/contract.mjs";
import { NATIVE_CODEX, checkTerminalRuntime, terminalEnv } from "../handoff/terminal-dispatch.mjs";
import { superviseNative } from "../handoff/terminal-supervision.mjs";
import { collectionExecArgs } from "./terminal-policy.mjs";
import { loadCollection } from "./package.ts";
import { loadImagePackage } from "../../image-companion/package.ts";
import { canonical } from "../../src/collections/codec.ts";
import { imageCollectionPrompt, imageReferenceName } from "../../src/collections/stages.ts";
import { COLLECTION_LIMITS as L } from "../../src/collections/limits.ts";

/** Fixed owned runner. Browser input can never supply arguments, executable or paths. */
export async function runCollectionImage(dir, seal, { nativeSpawn = spawn, runtimeCheck = checkTerminalRuntime, supervision = superviseNative } = {}) {
  dir = await safeDirectory(dir);
  const {envelope:e, seal:actualSeal} = await loadCollection(await bounded(join(dir,"collection.json"),L.transportBytes));
  if(e.operation!=="image" || actualSeal!==seal || !e.runtime) throw Error("Wrong image collection identity");
  const root=dirname(dirname(dir)),raw=await bounded(join(dir,"dispatch-intent.json"),32768),claim=JSON.parse(raw);
  const name=`claim-${String(claim.sequence).padStart(4,"0")}.json`;
  const names=(await readdir(root)).filter(n=>/^claim-\d{4}\.json$/.test(n)).sort();
  if(claim.kind!=="reword-collection-dispatch" || claim.version!==3 || claim.operation!=="image" || claim.collectionId!==e.id || claim.runtimeSha256!==e.runtimeSha256 || claim.seal!==seal || name!==names.at(-1) || !raw.equals(await bounded(join(root,name),32768))) throw Error("Native image claim binding mismatch");
  const runtime=await runtimeCheck(), prompt=imageCollectionPrompt(e),references=[],artifacts=[];
  const retain=async(name,bytes)=>{const b=Buffer.from(typeof bytes==="string" ? bytes : canonical(bytes));await durableFile(join(dir,name),b);artifacts.push({name,byteLength:b.length,sha256:hash(b)});};
  await mkdir(join(dir,"workspace"),{mode:0o700});
  for(const [i,m] of e.members.entries()) {
    const image=await loadImagePackage(Buffer.from(m.packageBase64,"base64")),name=imageReferenceName(i,m.sourceSha256);
    if(image.referenceSha256!==m.sourceSha256) throw Error("Native reference binding mismatch");
    await durableFile(join(dir,name),image.referenceBytes);
    references.push({ordinal:i+1,itemId:m.id,sourcePath:m.path,name,sha256:hash(image.referenceBytes),byteLength:image.referenceBytes.length,outputId:m.expectedOutputs[0].id});
  }
  const args=collectionExecArgs(dir,references.map(r=>r.name),{...e.runtime,overrides:['model_provider="openai"','forced_login_method="chatgpt"',"analytics.enabled=false","feedback.enabled=false"]});
  await retain("native-input.json",{executable:NATIVE_CODEX,args,stdinSha256:hash(prompt),references,binarySha256:runtime.binarySha256,requestedRuntime:e.runtime,taskDispatches:1,internalOperationCap:null});
  // Synced native-start claim precedes spawn. Failure never grants a retry.
  await retain("native-start-claimed.json",{kind:"reword-collection-native-start",version:1,dispatchId:claim.id,collectionId:e.id,seal,requestedRuntime:e.runtime,startedAt:new Date().toISOString()});
  const stdout=await open(join(dir,"native-stdout.jsonl"),"wx",0o600),stderr=await open(join(dir,"native-stderr.txt"),"wx",0o600);
  console.log(`Reword Nerd collection ${e.id}\n${references.length} selected references. One Codex task; internal operation count and cost are not capped. Outputs and acceptance remain in Codex.\n`);
  let supervised;
  try {
    const child=nativeSpawn(NATIVE_CODEX,args,{cwd:join(dir,"workspace"),env:terminalEnv(),stdio:["pipe",stdout.fd,stderr.fd],detached:true});
    supervised=await supervision(child,{stdout,stderr,prompt});
  } finally { await stdout.sync();await stderr.sync();await stdout.close();await stderr.close(); }
  const out=await bounded(join(dir,"native-stdout.jsonl"),40*1024*1024),err=await bounded(join(dir,"native-stderr.txt"),40*1024*1024);
  for(const [name,b] of [["native-stdout.jsonl",out],["native-stderr.txt",err]]) artifacts.push({name,byteLength:b.length,sha256:hash(b)});
  const events=[];let malformed=false;
  for(const line of out.toString("utf8").split("\n").filter(Boolean)) {try {events.push(JSON.parse(line));}catch {malformed=true;}}
  const threads=events.filter(x=>x.type==="thread.started");
  // This pinned CLI reports three verified startup warnings as error items.
  // Retain them explicitly; any other error item keeps the dispatch uncertain.
  const knownWarnings = [
    "`[features].request_permissions` is deprecated. Use `[features].exec_permission_approvals` instead. (Enable it with `--enable exec_permission_approvals` or `[features].exec_permission_approvals` in config.toml. See https://developers.openai.com/codex/config-basic#feature-flags for details.)",
    `Under-development features enabled: skip_host_skill_discovery. Under-development features are incomplete and may behave unpredictably. To suppress this warning, set \`suppress_unstable_features_warning = true\` in ${LEGACY_CONFIG_PATH}.`,
    "Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed; enable `features.code_mode_host` and install `codex-code-mode-host`.",
  ];
  const warningItems=events.filter(x=>x.item?.type==="error");
  const failed=events.some(x=>["turn.failed","error","model.rerouted"].includes(x.type)) || warningItems.some(x=>!knownWarnings.includes(x.item.message));
  const clean=!malformed && !supervised.reason && supervised.exit.code===0 && threads.length===1 && typeof threads[0].thread_id==="string" && events.filter(x=>x.type==="turn.completed").length===1 && !failed;
  const messages=events.filter(x=>x.item?.type==="agent_message").map(x=>x.item.text??"");
  const expectedOutputs=e.expectedOutputs.map(o=>({...o,status:"missing",acknowledgedInTaskText:messages.some(t=>t.includes(o.id)),automaticReturn:false}));
  await retain("output-manifest.json",{collectionId:e.id,expectedOutputs,generationSuccess:"not-inferred",acceptedByUser:false});
  await retain("task-outcome.json",{dispatchId:claim.id,seal,...supervised,taskId:threads[0]?.thread_id??null,taskDispatches:1,nativeCleanCompletion:clean,eventTypes:events.map(x=>x.type),startupWarnings:warningItems.map(x=>x.item.message),expectedOutputs,actualModel:null,actualEffort:null,requestedRuntime:e.runtime,generationSuccess:"not-inferred"});
  const outcome={dispatchId:claim.id,seal,status:clean?"awaiting-user-review":"failed-or-uncertain",error:clean?null:"Native task failed or became uncertain; no retry",nativeCleanCompletion:clean,taskId:threads[0]?.thread_id??null,actualExecutor:runtime.executor,actualModel:null,actualEffort:null,stageRequests:0,expectedOutputs,artifacts,acceptedByUser:false};
  await durableFile(join(dir,"outcome.json"),canonical(outcome));
  console.log(`Task ${outcome.taskId??"identity unknown"}: ${outcome.status}. Inspection artifacts: ${dir}`);
  return outcome;
}
