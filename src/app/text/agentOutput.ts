// Finds the files an agent wrote, however the person hands the finished folder back.

const TASK_FILES = new Set(["TASK.md", "AGENTS.md", "CLAUDE.md", "GEMINI.md", ".keep"]);

interface FoundOutput {
  files: { path: string; data: Blob }[];
  report: Blob | null;
}

/** Finds the agent's results in whatever was dropped: the whole task folder, output/, or a ZIP. */
export function agentOutput(files: { path: string; data: Blob }[]): FoundOutput {
  const normalized = files.map((file) => ({ ...file, path: file.path.replace(/\\/g, "/") }));
  const report = normalized.find((file) => /(^|\/)REPORT\.md$/i.test(file.path)) ?? null;
  const inOutput = normalized.flatMap((file) => {
    const at = file.path.indexOf("output/");
    if (at < 0 || (at > 0 && file.path[at - 1] !== "/")) return [];
    const path = file.path.slice(at + "output/".length);
    return path === ".keep" ? [] : [{ ...file, path }];
  });
  if (inOutput.length > 0) return { files: inOutput, report: report?.data ?? null };
  const loose = normalized.filter((file) => {
    const name = file.path.slice(file.path.lastIndexOf("/") + 1);
    return !TASK_FILES.has(name) && file !== report;
  });
  return { files: loose, report: report?.data ?? null };
}
