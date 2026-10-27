import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { durableFile } from "../handoff/repeatable-state.mjs";
import { canonical } from "../../src/collections/codec.ts";
import { shQuote } from "../handoff/contract.mjs";
const exec=promisify(execFile);
export function collectionImageLauncher(runner, openTerminal = file => exec("/usr/bin/open",["-a","Terminal",file])) {
  return async ({dir,claim,smokeBudgetRoot}) => {
    if(await realpath(runner)!==resolve(runner)) throw Error("Unsafe collection runner");
    // All command fields are fixed owned paths and a validated digest. No uploaded text enters this file.
    const command="#!/bin/sh\nexec "+[process.execPath,runner,dir,claim.seal,...(smokeBudgetRoot?[smokeBudgetRoot]:[])].map(shQuote).join(" ")+"\n";
    await durableFile(join(dir,"native-launch-claimed.json"),canonical({dispatchId:claim.id,seal:claim.seal,launchRequestedAt:new Date().toISOString()}));
    await writeFile(join(dir,"dispatch.command"),command,{flag:"wx",mode:0o700});
    try {await openTerminal(join(dir,"dispatch.command"));} catch {throw Error("Terminal startup is uncertain; the collection remains claimed");}
  };
}
