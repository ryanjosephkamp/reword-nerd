import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import {
  assessContext,
  CURATED_MODEL_PROFILES,
  DEFAULT_SETTINGS,
} from "../../src/domain";
import { buildPromptPackage, type DocumentWorkbook } from "../../src/export";
import { renderPromptBundle } from "../../src/prompting";
import { StudioPackage } from "../../src/app/studio/StudioPackage";

let workbook: DocumentWorkbook;
const sourceText = "A source document that needs thoughtful rewriting.";

beforeAll(async () => {
  const profile = CURATED_MODEL_PROFILES.find(
    (candidate) => candidate.id === "openai-general",
  )!;
  const bytes = new TextEncoder().encode(sourceText);
  const result = await buildPromptPackage([
    {
      documentId: "source",
      documentName: "source.txt",
      documentFormat: "text",
      original: {
        name: "source.txt",
        size: bytes.length,
        arrayBuffer: async () => bytes.slice().buffer,
      } as File,
      reviewedExtractedText: sourceText,
      resolvedSettings: { ...DEFAULT_SETTINGS },
      chosenProfile: profile,
      promptBundle: renderPromptBundle(sourceText, DEFAULT_SETTINGS, profile),
      warnings: [],
      contextAssessment: assessContext(sourceText, profile.contextWindowTokens),
      reviewed: true,
      contextWarningAcknowledged: false,
      uploadOrdinal: 0,
    },
  ]);
  if (!result.ok) throw new Error(result.error.message);
  workbook = result.workbooks[0];
});

function chooseStage(name: "Decompose" | "Rewrite" | "Verify" | "Final") {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`${name}$`) }));
}

function pasteResponse(value: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Model response" }), {
    target: { value },
  });
}

describe("Guided response review reminders", () => {
  it("preserves downstream responses and asks for renewed review after an earlier response changes", () => {
    render(
      <StudioPackage
        workbook={workbook}
        sourceText={sourceText}
        onDownload={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Guided workflow/ }));
    for (const stage of ["Decompose", "Rewrite", "Verify", "Final"] as const) {
      chooseStage(stage);
      pasteResponse(`${stage} original response.`);
    }
    expect(screen.getByText("4/4 responses added")).toBeInTheDocument();
    chooseStage("Decompose");
    pasteResponse("Decompose revised response with a corrected fact.");
    chooseStage("Final");
    expect(screen.getByRole("textbox", { name: "Model response" })).toHaveValue(
      "Final original response.",
    );
    expect(
      screen.getByText(/An earlier response changed. Review or replace/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Reviewed against updated inputs" }),
    );
    expect(
      screen.queryByText(/An earlier response changed. Review or replace/),
    ).toBeNull();
    chooseStage("Rewrite");
    expect(
      screen.getByText(/An earlier response changed. Review or replace/),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Model response" })).toHaveValue(
      "Rewrite original response.",
    );
    pasteResponse("A newly revised rewrite response.");
    expect(
      screen.queryByText(/An earlier response changed. Review or replace/),
    ).toBeNull();
    chooseStage("Final");
    expect(
      screen.getByText(/An earlier response changed. Review or replace/),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Model response" })).toHaveValue(
      "Final original response.",
    );
    expect(screen.getByText("4/4 responses added")).toBeInTheDocument();
  });

  it("preserves local result edits across workflow switches and warns before response replacement resets them", () => {
    render(
      <StudioPackage
        workbook={workbook}
        sourceText={sourceText}
        onDownload={() => undefined}
      />,
    );
    expect(
      screen.queryByText(
        /Changing this pasted response starts a fresh result review/,
      ),
    ).toBeNull();
    pasteResponse("The original pasted one-shot result.");
    expect(
      screen.getByText(
        /Changing this pasted response starts a fresh result review/,
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review result" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit result" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Your result text" }),
      { target: { value: "My careful local edit." } },
    );
    fireEvent.click(screen.getByRole("button", { name: /Guided workflow/ }));
    pasteResponse("A separate decomposition response.");
    fireEvent.click(screen.getByRole("button", { name: /One-shot/ }));
    expect(
      screen.getByRole("textbox", { name: "Your result text" }),
    ).toHaveValue("My careful local edit.");
    expect(screen.getByRole("textbox", { name: "Model response" })).toHaveValue(
      "The original pasted one-shot result.",
    );
    expect(
      screen.getByText(/Progress HTML stores your pasted responses/),
    ).toBeInTheDocument();
    pasteResponse("A replacement pasted response.");
    fireEvent.click(screen.getByRole("button", { name: "Edit result" }));
    expect(
      screen.getByRole("textbox", { name: "Your result text" }),
    ).toHaveValue("A replacement pasted response.");
  });
});


it("keeps literal prerequisites intact in the actual Studio guided editor", () => {
  render(<StudioPackage workbook={workbook} sourceText={sourceText} onDownload={() => undefined} />);
  fireEvent.click(screen.getByRole("button", { name: /Guided workflow/ }));
  const literal = "$& $$ $` $' café\n<<<INSERT_STAGE_2_REWRITE_RESPONSE>>>\n<<<INSERT_STAGE_3_VERIFICATION_RESPONSE>>>  ";
  chooseStage("Decompose"); pasteResponse(literal);
  chooseStage("Rewrite"); pasteResponse("Rewrite literal " + literal);
  chooseStage("Verify"); pasteResponse("Verify literal " + literal);
  chooseStage("Final");
  const textareas = screen.getAllByRole("textbox").map((node) => (node as HTMLTextAreaElement).value);
  expect(textareas.some((text) => text.includes(literal) && text.includes("Rewrite literal " + literal) && text.includes("Verify literal " + literal))).toBe(true);
});
