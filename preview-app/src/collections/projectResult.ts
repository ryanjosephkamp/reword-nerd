import { sourceBoundaryToken } from "../prompting/sourceBoundary";
import { uniquePaths } from "./limits";
/** Parse the established project contract; content is never executed or applied. */
export function parseProjectFinal(raw: string, context: {reviewedTreeHash:string;includedFiles:readonly {path:string;text:string}[];excludedPaths:readonly string[]}) {
  const names = ["CHANGED_FILES", "UNCHANGED_PATHS", "EXCLUDED_PATHS", "RISK_MANIFEST"];
  const sections: Record<string, string> = {};
  let rest = raw;
  for (const name of names) {
    const start = `<<<${name}>>>`, end = `<<<END_${name}>>>`;
    if (!rest.startsWith(start + "\n")) throw Error("Project final sections missing or out of order");
    const at = rest.indexOf("\n" + end, start.length + 1);
    if (at < 0) throw Error("Project final section is incomplete");
    sections[name] = rest.slice(start.length + 1, at);
    rest = rest.slice(at + end.length + 1).replace(/^\n{1,2}/u, "");
  }
  if (rest !== "") throw Error("Unexpected project final content");
  const boundary = sourceBoundaryToken(context.reviewedTreeHash, context.includedFiles);
  const begin = `${boundary} BEGIN CHANGED FILES\n`, end = `\n${boundary} END CHANGED FILES`;
  let changed = sections.CHANGED_FILES;
  if (!changed.startsWith(begin) || !changed.endsWith(end)) throw Error("Project changed-file boundary mismatch");
  changed = changed.slice(begin.length, -end.length);
  const files: { path: string; text: string }[] = [];
  if (changed !== "None.") while (changed) {
    const lineEnd = changed.indexOf("\n"), line = changed.slice(0, lineEnd);
    const prefix = `${boundary} BEGIN CHANGED FILE `;
    if (lineEnd < 0 || !line.startsWith(prefix)) throw Error("Malformed changed-file block");
    const path = line.slice(prefix.length), closer = `${boundary} END CHANGED FILE ${path}`;
    const at = changed.indexOf("\n" + closer, lineEnd);
    if (at < 0) throw Error("Missing changed-file terminator");
    files.push({ path, text: changed.slice(lineEnd + 1, at + 1) });
    changed = changed.slice(at + closer.length + 1).replace(/^\n/u, "");
  }
  const list = (value: string) => value === "None." ? [] : value.split("\n").map(line => { if (!line.startsWith("- ") || !line.slice(2)) throw Error("Malformed project path list"); return line.slice(2); });
  const unchanged = list(sections.UNCHANGED_PATHS), excluded = list(sections.EXCLUDED_PATHS);
  const paths = [...files.map(f => f.path), ...unchanged]; uniquePaths(paths); uniquePaths(excluded);
  const sorted = (paths: string[]) => { if (JSON.stringify(paths) !== JSON.stringify([...paths].sort())) throw Error("Project output paths are not in canonical order"); };
  sorted(files.map(f => f.path)); sorted(unchanged); sorted(excluded);
  const same = (a: string[], b: readonly string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  if (!same(paths, context.includedFiles.map(f => f.path)) || !same(excluded, context.excludedPaths)) throw Error("Project output omits or invents an included/excluded path");
  const risks = sections.RISK_MANIFEST === "None." ? [] : list(sections.RISK_MANIFEST);
  sorted(risks.map(line => line.split(" | ")[0]));
  for (const line of risks) {
    const path = line.split(" | ")[0];
    if (!paths.includes(path) || !line.includes(" | REVIEW | ")) throw Error("Invalid project risk path");
  }
  return { files, unchanged, excluded, riskManifest: sections.RISK_MANIFEST, applied: false, testsRun: false };
}
