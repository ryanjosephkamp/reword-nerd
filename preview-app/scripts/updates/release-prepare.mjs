#!/usr/bin/env node
import { prepareRelease } from "./lib.mjs";
import { parseNamedArguments, runCommand } from "./cli.mjs";

await runCommand(async () => prepareRelease(process.cwd(), parseNamedArguments(process.argv.slice(2), ["version", "title", "date"])));
