import { homedir } from "node:os";
import { join } from "node:path";

// These legacy defaults remain subject to the adapter version and binary pins.
export const LEGACY_CODEX_PATH = join(homedir(), ".local", "bin", "codex");
export const LEGACY_CONFIG_PATH = join(homedir(), ".codex", "config.toml");
