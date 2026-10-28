import { describe, expect, it } from "vitest";
import { DEFAULT_JOB, withGoal } from "../../../src/engine/job";
import {
  buildOnePrompt,
  buildStagePrompt,
  fillStagePrompt,
  replyPlaceholder,
  sourceMarker,
  type TextBatch,
} from "../../../src/engine/handoff/textPrompt";

const essay: TextBatch = {
  title: "essay.md",
  files: [
    {
      path: "essay.md",
      text: "# Gardens\n\nA garden brings neighbors together.",
      format: "markdown",
    },
  ],
  project: null,
  figures: [],
};

describe("buildOnePrompt", () => {
  it("puts the source first, then the task, settings, and a two-block output format", () => {
    const prompt = buildOnePrompt(essay, withGoal(DEFAULT_JOB, "polish"));
    const source = prompt.indexOf("<<<SOURCE essay.md>>>");
    const task = prompt.indexOf("## Your task");
    expect(source).toBeGreaterThan(0);
    expect(task).toBeGreaterThan(source);
    expect(prompt).toContain("A garden brings neighbors together.");
    expect(prompt).toContain("- Goal: Polish it.");
    expect(prompt).toContain("- Tone: Professional");
    expect(prompt).toContain("<<<FINAL_DOCUMENT>>>");
    expect(prompt).not.toContain("<<<FILE path/to/file.ext>>>");
  });

  it("asks for one block per changed file when there are several files", () => {
    const batch: TextBatch = {
      ...essay,
      title: "two files",
      files: [...essay.files, { path: "notes.txt", text: "More notes.", format: "text" }],
    };
    const prompt = buildOnePrompt(batch, DEFAULT_JOB);
    expect(prompt).toContain("Below are 2 files from several documents");
    expect(prompt).toContain("<<<FILE path/to/file.ext>>>");
    expect(prompt).not.toContain("<<<FINAL_DOCUMENT>>>");
  });

  it("adds code rules for code files and never says code may change", () => {
    const batch: TextBatch = {
      title: "app.py",
      files: [{ path: "app.py", text: "# Say hello\nprint('hi')\n", format: "code" }],
      project: null,
      figures: [],
    };
    const prompt = buildOnePrompt(batch, DEFAULT_JOB);
    expect(prompt).toContain("## Code and structured files");
    expect(prompt).toContain("- Code comments and docstrings: may change");
    expect(prompt).toContain("syntax: never change");
  });

  it("tells chat models that Word text comes back as Markdown", () => {
    const batch: TextBatch = {
      ...essay,
      files: [{ path: "report.docx", text: "# Report", format: "docx" }],
    };
    expect(buildOnePrompt(batch, DEFAULT_JOB)).toContain("## Converted documents");
  });

  it("lists figures with their captions", () => {
    const batch: TextBatch = {
      ...essay,
      figures: [
        {
          ref: "asset:asset-0123456789ab",
          filename: "figure-1.png",
          taskPath: "assets/essay.md/figure-1.png",
          caption: "Raised beds",
          pageNumber: 2,
        },
      ],
    };
    expect(buildOnePrompt(batch, DEFAULT_JOB)).toContain(
      "- `asset:asset-0123456789ab` is figure-1.png (page 2; caption: Raised beds)",
    );
  });
});

describe("sourceMarker", () => {
  it("changes the marker when the source already contains it", () => {
    const batch: TextBatch = {
      ...essay,
      files: [{ path: "a.md", text: "Literal <<<SOURCE in the text", format: "markdown" }],
    };
    expect(sourceMarker(batch)).toBe("<<<1:");
    expect(buildOnePrompt(batch, DEFAULT_JOB)).toContain("<<<1:SOURCE a.md>>>");
  });
});

describe("step-by-step prompts", () => {
  it("leaves placeholders for earlier replies and fills them in order", () => {
    const verify = buildStagePrompt(essay, DEFAULT_JOB, "verify");
    expect(verify).toContain("stage 3 of a four-stage rewrite");
    expect(verify).toContain(replyPlaceholder("decompose"));
    expect(verify).toContain(replyPlaceholder("rewrite"));
    expect(verify).not.toContain(replyPlaceholder("verify"));

    const filled = fillStagePrompt(verify, "verify", {
      decompose: "## Main point\nGardens help.",
      rewrite: "Gardens connect people. $& stays literal.",
    });
    expect(filled).toContain("Gardens connect people. $& stays literal.");
    expect(filled).not.toContain(replyPlaceholder("decompose"));
  });

  it("refuses to fill a stage before the earlier reply is pasted", () => {
    const rewrite = buildStagePrompt(essay, DEFAULT_JOB, "rewrite");
    expect(() => fillStagePrompt(rewrite, "rewrite", {})).toThrow("stage 1");
  });

  it("puts the output format only on the final stage", () => {
    expect(buildStagePrompt(essay, DEFAULT_JOB, "decompose")).not.toContain("<<<FINAL_DOCUMENT>>>");
    expect(buildStagePrompt(essay, DEFAULT_JOB, "final")).toContain("<<<FINAL_DOCUMENT>>>");
  });
});
