import { describe, expect, it } from "vitest";
import { guessShell, taskSlug, terminalCommand } from "../../../src/engine/handoff/commands";
import { destination } from "../../../src/engine/handoff/destinations";

const when = new Date(2026, 9, 28, 9, 5);

describe("taskSlug", () => {
  it("makes a short, shell-safe folder name with a timestamp", () => {
    expect(taskSlug("Urban gardens: a proposal (draft).docx", when)).toBe(
      "rn-urban-gardens-a-proposal-draft-1028-0905",
    );
    expect(taskSlug("!!!", when)).toBe("rn-task-1028-0905");
  });
});

describe("terminalCommand", () => {
  it("opens or unzips the folder, then starts the agent", () => {
    expect(terminalCommand("rn-essay-1028-0905", destination("claude-code"), "unix")).toBe(
      'cd ~/Downloads && { [ -d rn-essay-1028-0905 ] || unzip -q rn-essay-1028-0905.zip; } && cd rn-essay-1028-0905 && claude "Follow TASK.md"',
    );
    expect(terminalCommand("rn-x", destination("codex"), "unix")).toMatch(
      /&& codex "Follow TASK.md"$/,
    );
    expect(terminalCommand("rn-x", destination("gemini-cli"), "unix")).toMatch(
      /&& gemini -i "Follow TASK.md"$/,
    );
  });

  it("only opens the folder for an agent without a known command", () => {
    expect(terminalCommand("rn-x", destination("other-agent"), "unix")).toMatch(/&& cd rn-x$/);
  });

  it("has a PowerShell version", () => {
    expect(terminalCommand("rn-x", destination("claude-code"), "powershell")).toBe(
      'cd ~\\Downloads; if (-not (Test-Path rn-x)) { Expand-Archive rn-x.zip -DestinationPath . }; cd rn-x; claude "Follow TASK.md"',
    );
  });

  it("guesses PowerShell on Windows only", () => {
    expect(guessShell("Win32")).toBe("powershell");
    expect(guessShell("MacIntel")).toBe("unix");
    expect(guessShell("Linux x86_64")).toBe("unix");
  });
});
