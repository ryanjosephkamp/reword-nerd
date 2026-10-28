// The one line a person pastes into a terminal: open the downloaded task folder and start
// their agent on it. Safari unzips downloads on its own, so the command handles both cases.
import type { Destination } from "./destinations";

export type Shell = "unix" | "powershell";

export const AGENT_INSTRUCTION = "Follow TASK.md";

/** Lowercase letters, digits, and dashes only, so the folder name never needs quoting. */
export function taskSlug(title: string, now: Date = new Date()): string {
  const base =
    title
      .replace(/\.[a-z0-9]{1,5}$/i, "")
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .toLowerCase()
      .trim()
      .replace(/[\s_]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32)
      .replace(/-$/, "") || "task";
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `rn-${base}-${stamp}`;
}

export function guessShell(platform: string = globalThis.navigator?.platform ?? ""): Shell {
  return /win/i.test(platform) ? "powershell" : "unix";
}

/** Returns the command, or null when the agent has no known command (the folder step is still useful). */
export function terminalCommand(folder: string, agent: Destination, shell: Shell): string {
  const launch = agent.launch?.(AGENT_INSTRUCTION);
  if (shell === "powershell") {
    const open = `cd ~\\Downloads; if (-not (Test-Path ${folder})) { Expand-Archive ${folder}.zip -DestinationPath . }; cd ${folder}`;
    return launch ? `${open}; ${launch}` : open;
  }
  const open = `cd ~/Downloads && { [ -d ${folder} ] || unzip -q ${folder}.zip; } && cd ${folder}`;
  return launch ? `${open} && ${launch}` : open;
}
