import { describe, expect, it } from "vitest";
import { DEFAULT_JOB } from "../../../src/engine/job";
import {
  buildTaskMarkdown,
  buildTextTaskZip,
  type TextTaskInput,
} from "../../../src/engine/handoff/agentTask";
import { readZip } from "../../../src/engine/handoff/zip";

function input(overrides: Partial<TextTaskInput> = {}): TextTaskInput {
  return {
    batch: {
      title: "Report",
      files: [{ path: "report.docx", text: "# Report\n\nFindings.", format: "docx" }],
      project: null,
      figures: [],
    },
    files: [
      {
        path: "report.docx",
        original: new Blob(["docx bytes"]),
        text: "# Report\n\nFindings.",
        extractedText: "# Report\n\nFindings.",
        format: "docx",
      },
      {
        path: "notes.md",
        original: new Blob(["Notes."]),
        text: "Notes.",
        extractedText: "Notes.",
        format: "markdown",
      },
    ],
    assets: [],
    ...overrides,
  };
}

describe("buildTaskMarkdown", () => {
  it("maps every file to where its text lives and where the result goes", () => {
    const task = buildTaskMarkdown(input(), DEFAULT_JOB);
    expect(task).toContain(
      "| `source/report.docx` | `text/report.docx.md` | `output/report.docx` |",
    );
    expect(task).toContain("| `source/notes.md` | `source/notes.md` | `output/notes.md` |");
    expect(task).toContain("Word and PDF originals become Word files");
    expect(task).toContain("## Decomposition format");
    expect(task).toContain("don't use the network");
    expect(task).not.toContain("## Converted documents");
  });

  it("points at text/ when the user edited a file", () => {
    const edited = input();
    edited.files[1] = { ...edited.files[1], text: "Edited notes." };
    expect(buildTaskMarkdown(edited, DEFAULT_JOB)).toContain(
      "| `source/notes.md` | `text/notes.md` | `output/notes.md` |",
    );
  });

  it("turns PDF results into Word files", () => {
    const pdf = input({
      files: [
        {
          path: "paper.pdf",
          original: new Blob(["%PDF-"]),
          text: "Text",
          extractedText: "Text",
          format: "pdf",
        },
      ],
    });
    expect(buildTaskMarkdown(pdf, DEFAULT_JOB)).toContain("`output/paper.docx`");
  });
});

describe("buildTextTaskZip", () => {
  it("packs one top-level folder with the task, pointers, sources, and text copies", async () => {
    const zip = await buildTextTaskZip(input(), DEFAULT_JOB, "rn-report-1028-0905");
    const paths = (await readZip(zip)).map((file) => file.path).sort();
    expect(paths).toEqual([
      "rn-report-1028-0905/AGENTS.md",
      "rn-report-1028-0905/CLAUDE.md",
      "rn-report-1028-0905/GEMINI.md",
      "rn-report-1028-0905/TASK.md",
      "rn-report-1028-0905/output/.keep",
      "rn-report-1028-0905/source/notes.md",
      "rn-report-1028-0905/source/report.docx",
      "rn-report-1028-0905/text/report.docx.md",
      "rn-report-1028-0905/work/.keep",
    ]);
  });
});
