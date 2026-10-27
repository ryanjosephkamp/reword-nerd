import { LEGACY_CODEX_PATH } from "../runtime-paths.mjs";
// An explicit, human-confirmed terminal launch. Opening this review never starts Codex.
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifySnapshot, hash, promptText, cliArgs } from "./contract.mjs";
export async function inspectReview(dir, seal) {
  const verified = await verifySnapshot(dir, seal);
  const s = verified.snapshot;
  if (s.launcher?.codexPath !== LEGACY_CODEX_PATH)
    throw Error("Unsupported executable");
  const binary = await readFile(s.launcher.codexPath);
  if (hash(binary) !== s.launcher.codexSha256)
    throw Error("Installed Codex changed; prepare a new launch review");
  return {
    ...verified,
    args: cliArgs(s, dir, promptText(verified.files["prompt.txt"])),
  };
}
export async function runReview(dir, seal) {
  const { snapshot: s, files } = await inspectReview(dir, seal);
  const event = {
    handoffId: s.id,
    snapshotSha256: seal,
    openedAt: new Date().toISOString(),
    kind: "terminal-launch-review-opened",
    modelCalls: 0,
  };
  try {
    await writeFile(
      join(dir, "review-opened.json"),
      JSON.stringify(event, null, 2),
      { flag: "wx", mode: 0o600 },
    );
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  console.log("\nREWORD NERD · CODEX TERMINAL LAUNCH REVIEW\n");
  console.log(
    "Handoff: " +
      s.id +
      "\nSource: " +
      JSON.stringify(s.displayName) +
      "\nPrompt SHA-256: " +
      s.promptSha256 +
      "\nReference SHA-256: " +
      s.referenceSha256,
  );
  console.log(
    "\nExact prompt and original source bytes have been saved. The official CLI input constructor is tested offline; no Codex task has been created.",
  );
  console.log(
    "This is a launch review, not a created Codex draft or completed image. Existing host sign-in, model support and generation have not been checked.",
  );
  console.log(
    "Execution is unavailable in this checkpoint. The ordinary interactive CLI has no established operation-count cap, and its effective inherited tool boundary has not been demonstrated for this launcher.",
  );
  console.log(
    "This review does not inspect authentication, run login checks, start a model or consume provider usage. Manual exports and the existing bounded four-stage text connection remain available.",
  );
  console.log(
    "A read-only label or disabled-feature list alone does not prove isolation. Actual target model/image capability remains unknown.",
  );
  console.log(
    "\nPrompt preview (escaped to keep terminal control characters inert):\n" +
      JSON.stringify(promptText(files["prompt.txt"]).slice(0, 1800)),
  );
  console.log(
    "\nType VIEW to print the complete escaped prompt. Any other input closes this review. START is unavailable.",
  );
  if (!process.stdin.isTTY || !process.stdout.isTTY) return;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let answer = await rl.question("Choice: ");
  if (answer === "VIEW") {
    console.log(JSON.stringify(promptText(files["prompt.txt"])));
    answer = await rl.question("Press Enter to close this review: ");
  }
  rl.close();
  console.log(
    answer === "START"
      ? "Start blocked: this checkpoint does not dispatch Codex tasks."
      : "Closed without starting a harness or model.",
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  runReview(resolve(process.argv[2] ?? ""), process.argv[3] ?? "").catch(
    (e) => {
      console.error("Launch stopped: " + JSON.stringify(e.message));
      process.exitCode = 1;
    },
  );
