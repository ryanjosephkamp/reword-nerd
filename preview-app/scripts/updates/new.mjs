#!/usr/bin/env node
import { createUpdate } from "./lib.mjs";
import { parseNamedArguments, runCommand } from "./cli.mjs";

await runCommand(async () => createUpdate(process.cwd(), parseNamedArguments(process.argv.slice(2), ["slug", "title", "date"])));
