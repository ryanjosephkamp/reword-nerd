import { it, expect } from "vitest";
import { projectFixture } from "./fixtures";
import { parseProjectFinal } from "../../src/collections/projectResult";
import { fromWire } from "../../src/collections/codec";
import { sourceContext } from "../../src/collections/prepare";
import { sourceBoundaryToken } from "../../src/prompting/renderPromptSet";
import type { ExportSourceInput } from "../../src/export";
it("accounts for every changed/unchanged/excluded project file and retains complete protected syntax",async()=>{
  const fixture=await projectFixture(),context=sourceContext(fromWire(fixture.members[0].preparation) as ExportSourceInput);
  if(context.kind!=="project")throw Error("Project required");
  const boundary=sourceBoundaryToken(context.reviewedTreeHash,context.includedFiles),file=context.includedFiles.find(f=>f.path==="src/main.ts")!;
  const changed='// Clear useful comment\nexport const greeting = "Hello";\n';
  const raw=`<<<CHANGED_FILES>>>\n${boundary} BEGIN CHANGED FILES\n${boundary} BEGIN CHANGED FILE ${file.path}\n${changed}${boundary} END CHANGED FILE ${file.path}\n${boundary} END CHANGED FILES\n<<<END_CHANGED_FILES>>>\n\n<<<UNCHANGED_PATHS>>>\n${context.includedFiles.filter(f=>f.path!==file.path).map(f=>"- "+f.path).join("\n")}\n<<<END_UNCHANGED_PATHS>>>\n\n<<<EXCLUDED_PATHS>>>\n${context.excludedPaths.map(p=>"- "+p).join("\n")}\n<<<END_EXCLUDED_PATHS>>>\n\n<<<RISK_MANIFEST>>>\nNone.\n<<<END_RISK_MANIFEST>>>`;
  const result=parseProjectFinal(raw,context);expect(result.files).toEqual([{path:file.path,text:changed}]);expect(result.unchanged).toHaveLength(6);expect(result.excluded).toHaveLength(2);expect(result.testsRun).toBe(false);expect(result.applied).toBe(false);
  for(const mutation of [raw.replace("- north/readme.md\n",""),raw.replace("- north/readme.md","- outside.md"),raw.replace("- north/readme.md","- src/main.ts"),raw+"\nI ran tests."])expect(()=>parseProjectFinal(mutation,context)).toThrow();
});
