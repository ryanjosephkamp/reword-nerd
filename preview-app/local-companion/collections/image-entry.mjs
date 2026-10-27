import { resolve, join } from "node:path";
import { runCollectionImage } from "./image-run.mjs";
import { durableFile } from "../handoff/repeatable-state.mjs";
import { safeDirectory } from "../handoff/contract.mjs";
const [dir,seal,budget]=process.argv.slice(2);
try {
  const result=await runCollectionImage(resolve(dir??""),seal);
  if(!result.nativeCleanCompletion) throw Error(result.error);
} catch(error) {
  if(budget) {await safeDirectory(budget);await durableFile(join(budget,"smoke-stopped.json"),JSON.stringify({reason:error.message})).catch(()=>{});}
  console.error("Collection task stopped: "+error.message);process.exitCode=1;
}
