import { EFFORT_ID, RUNTIME_ID, type RuntimeChoice } from "./runtime.mjs";
export const RUNTIME_PREFERENCE_KEY = "reword-nerd-runtime-preferences-v1";
const valid = (x: unknown): x is RuntimeChoice => typeof x === "object" && x !== null
  && Object.keys(x).sort().join(",") === "effort,model"
  && typeof (x as RuntimeChoice).model === "string" && RUNTIME_ID.test((x as RuntimeChoice).model)
  && typeof (x as RuntimeChoice).effort === "string" && EFFORT_ID.test((x as RuntimeChoice).effort);
export function recentRuntimes(storage: Pick<Storage, "getItem">): RuntimeChoice[] {
  try {
    const raw = storage.getItem(RUNTIME_PREFERENCE_KEY);
    if (!raw || raw.length > 4096) return [];
    const p = JSON.parse(raw);
    if (p.version !== 1 || Object.keys(p).sort().join(",") !== "codex,version" || !Array.isArray(p.codex) || p.codex.length > 5 || !p.codex.every(valid)) return [];
    return p.codex;
  } catch { return []; }
}
export function rememberRuntime(storage: Pick<Storage, "getItem" | "setItem">, choice: RuntimeChoice): void {
  if (!valid(choice)) throw Error("Invalid runtime preference");
  storage.setItem(RUNTIME_PREFERENCE_KEY, JSON.stringify({ version: 1, codex: [choice, ...recentRuntimes(storage).filter(x => x.model !== choice.model || x.effort !== choice.effort)].slice(0, 5) }));
}
export function forgetRuntimes(storage: Pick<Storage, "removeItem">): void { storage.removeItem(RUNTIME_PREFERENCE_KEY); }
