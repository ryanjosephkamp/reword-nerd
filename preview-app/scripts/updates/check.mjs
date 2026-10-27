#!/usr/bin/env node
import { checkUpdates } from "./lib.mjs";
import { runCommand } from "./cli.mjs";

await runCommand(async () => {
  const { ledger, version } = await checkUpdates(process.cwd());
  return `Updates valid: ${ledger.entries.length} entries; current release ${version}; manifest schema 6; workbook progress schema 1.`;
});
