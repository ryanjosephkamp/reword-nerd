import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
const output="src/collections/workbookRuntime.generated.txt";
const built=await build({entryPoints:["src/collections/workbookEntry.ts"],bundle:true,write:false,format:"iife",target:"es2022",platform:"browser",minify:true,legalComments:"none"});
const text=built.outputFiles[0].text;
if(process.argv.includes("--check")){if(await readFile(output,"utf8")!==text)throw Error("Collection workbook runtime is stale; regenerate from the shared canonical modules.");console.log("Collection workbook runtime matches shared source.");}else await writeFile(output,text);
