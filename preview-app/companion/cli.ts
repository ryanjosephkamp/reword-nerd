import { resolve, join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import {
  prepareJob,
  nextStage,
  recordResponse,
  getStatus,
  exportJob,
  inspectPackage,
  RunnerError,
  STAGES,
  type Stage,
} from "./runner";
import { createFixturePackage } from "./fixtures";

const help = `Reword Nerd local runner — no provider client or keys\n\nUsage:\n  node companion/cli.mjs inspect PACKAGE.zip\n  node companion/cli.mjs prepare PACKAGE.zip --job NEW_DIRECTORY [--host NAME] [--model NAME]\n  node companion/cli.mjs next --job DIRECTORY [--stage STAGE --revise | --retry]\n  node companion/cli.mjs record-response --job DIRECTORY --ticket TICKET.json --response RESPONSE.txt\n  node companion/cli.mjs status --job DIRECTORY\n  node companion/cli.mjs export --job DIRECTORY --out NEW_DIRECTORY\n  node companion/cli.mjs fixture --out NEW_DIRECTORY\n\nThe host skill supplies actual stage responses. Fixture mode uses labeled prerecorded text and makes no model request.\n`;
function parse(args: string[]) {
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};
  const booleans = new Set(["revise", "retry", "help"]);
  const names = new Set([
    "job",
    "out",
    "host",
    "model",
    "stage",
    "ticket",
    "response",
    ...booleans,
  ]);
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith("--")) {
      positionals.push(args[i]);
      continue;
    }
    const name = args[i].slice(2);
    if (!names.has(name) || name in flags)
      throw new RunnerError("ARGUMENT", "Unknown or duplicate option.");
    if (booleans.has(name)) {
      flags[name] = true;
      continue;
    }
    const value = args[++i];
    if (!value || value.startsWith("--"))
      throw new RunnerError("ARGUMENT", `--${name} requires a value.`);
    flags[name] = value;
  }
  return { positionals, flags };
}
async function main() {
  const { positionals, flags } = parse(process.argv.slice(2));
  const command = positionals[0];
  if (!command || command === "help" || flags.help) {
    process.stdout.write(help);
    return;
  }
  const allowed: Record<string, string[]> = {
    inspect: [],
    prepare: ["job", "host", "model"],
    next: ["job", "stage", "revise", "retry"],
    "record-response": ["job", "ticket", "response"],
    status: ["job"],
    export: ["job", "out"],
    fixture: ["out"],
  };
  if (!allowed[command]) throw new RunnerError("ARGUMENT", "Unknown command. Use help.");
  if (Object.keys(flags).some((flag) => !allowed[command].includes(flag)))
    throw new RunnerError("ARGUMENT", `An option is not supported by ${command}.`);
  if (!["inspect", "prepare"].includes(command) && positionals.length !== 1)
    throw new RunnerError("ARGUMENT", "Unexpected positional argument.");
  const arg = (name: string) => {
    const value = flags[name];
    if (typeof value !== "string") throw new RunnerError("ARGUMENT", `--${name} is required.`);
    return resolve(value);
  };
  const packagePath = () => {
    if (positionals.length !== 2)
      throw new RunnerError("ARGUMENT", "Choose exactly one package ZIP.");
    return resolve(positionals[1]);
  };
  let result: unknown;
  switch (command) {
    case "inspect": {
      const pkg = await inspectPackage(packagePath());
      result = {
        supported: true,
        documentName: pkg.documentName,
        documentKey: pkg.documentKey,
        packageSha256: pkg.packageSha256,
        sourceSha256: pkg.sourceSha256,
        schemaVersion: pkg.manifest.schemaVersion,
        modelProfile: pkg.manifest.documents[0].model,
        stages: STAGES,
      };
      break;
    }
    case "prepare":
      result = await prepareJob(packagePath(), arg("job"), {
        mode: "host-assisted",
        host: typeof flags.host === "string" ? flags.host : "unknown",
        model: typeof flags.model === "string" ? flags.model : "unknown",
      });
      break;
    case "next":
      result = await nextStage(arg("job"), {
        stage: typeof flags.stage === "string" ? (flags.stage as Stage) : undefined,
        revise: flags.revise === true,
        retry: flags.retry === true,
      });
      break;
    case "record-response":
      result = await recordResponse(arg("job"), arg("ticket"), arg("response"));
      break;
    case "status":
      result = await getStatus(arg("job"));
      break;
    case "export":
      result = await exportJob(arg("job"), arg("out"));
      break;
    case "fixture": {
      const dir = arg("out");
      await mkdir(dir, { mode: 0o700 });
      const zip = join(dir, "fixture-package.zip");
      await writeFile(zip, await createFixturePackage(), { flag: "wx", mode: 0o600 });
      const job = join(dir, "job");
      await prepareJob(zip, job, { mode: "fixture", host: "deterministic-fixture", model: "none" });
      const answers: Record<Stage, string> = {
        decompose:
          "## Fixture decomposition\nThis is prerecorded test data used to exercise stage transport, not model analysis.\n",
        rewrite: "This prerecorded candidate exercises the local workflow.\n",
        verify:
          "## Fixture verification\nNo semantic quality claim is made by this deterministic test.\n",
        final: "This is a deterministic fixture output. A model did not generate it.\n",
      };
      for (const stage of STAGES) {
        const next = await nextStage(job);
        if (!next.ticketPath) throw Error("Fixture ticket missing.");
        const response = join(job, "inbox", `${stage}.txt`);
        await writeFile(response, answers[stage], { flag: "wx" });
        await recordResponse(job, next.ticketPath, response);
      }
      result = {
        fixture: true,
        packagePath: zip,
        jobPath: job,
        ...(await exportJob(job, join(dir, "export"))),
      };
      break;
    }
    default:
      throw new RunnerError("ARGUMENT", "Unknown command. Use help.");
  }
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
await main().catch((error) => {
  const value = error as Error & { code?: string };
  process.stderr.write(
    JSON.stringify({ error: { code: value.code ?? "RUNNER_ERROR", message: value.message } }) +
      "\n",
  );
  process.exitCode = 1;
});
