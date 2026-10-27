import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import oneShotPrompt from "../../prompts/00_one_shot.md?raw";
import { StudioResultReview } from "../../src/app/studio/StudioResultReview";
import {
  downloadStudioResult,
  parseStudioResult,
  RESULT_PREVIEW_LIMIT,
} from "../../src/app/studio/resultReview";
import * as clipboard from "../../src/app/workbench/copyText";

const response = `<<<FINAL_DOCUMENT>>>\n# A greener neighborhood\n\nWe can plant a garden together.\n<<<END_FINAL_DOCUMENT>>>\n\n<<<FIDELITY_AUDIT>>>\nMeaning: PASS — Model claim only.\n<<<END_FIDELITY_AUDIT>>>`;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Canonical result boundaries", () => {
  it("extracts a unique canonical final document and keeps the model audit separate", () => {
    const result = parseStudioResult(response);
    expect(result.mode).toBe("final-document");
    expect(result.text).toBe(
      "# A greener neighborhood\n\nWe can plant a garden together.",
    );
    expect(result.audit).toBe("Meaning: PASS — Model claim only.");
    expect(parseStudioResult(response.replaceAll("\n", "\r\n")).text).toBe(
      "# A greener neighborhood\r\n\r\nWe can plant a garden together.",
    );
  });

  it.each([
    "A plain final-stage response, without markers.\n",
    "<<<FINAL_DOCUMENT>>>\nIncomplete final document",
    `${response}\n${response}`,
    `Preamble containing a quoted contract:\n${response}`,
    `${response}\nAdditional unstructured commentary`,
    "<<<FINAL_DOCUMENT>>>\n\n<<<END_FINAL_DOCUMENT>>>",
    "<<<FINAL_DOCUMENT>>> Inline content <<<END_FINAL_DOCUMENT>>>",
    oneShotPrompt,
  ])("preserves ambiguous or unmarked content in full (%#)", (input) => {
    const result = parseStudioResult(input);
    expect(result.mode).toBe("full-response");
    expect(result.text).toBe(input);
    expect(result.audit).toBeNull();
  });

  it("accepts a standalone final block without inventing missing audit notes", () => {
    const result = parseStudioResult(
      "<<<FINAL_DOCUMENT>>>\n  Keep indentation.\n\n<<<END_FINAL_DOCUMENT>>>",
    );
    expect(result.mode).toBe("final-document");
    expect(result.text).toBe("  Keep indentation.\n");
    expect(result.audit).toBeNull();
  });
});

describe("Result review interactions", () => {
  it("renders marked content and keeps edits separate from the pasted response", async () => {
    const copy = vi.spyOn(clipboard, "copyText").mockResolvedValue("copied");
    render(
      <StudioResultReview
        sourceText="We propose a garden."
        response={response}
      />,
    );
    expect(screen.getByText("Extracted final document")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "A greener neighborhood" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit result" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Your result text" }),
      { target: { value: "My reviewed document.\n" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy result" }));
    await waitFor(() =>
      expect(copy).toHaveBeenCalledWith("My reviewed document.\n"),
    );
    expect(
      screen.getByText("Extracted final document · Edited here"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Compare with source" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Side by side" }));
    expect(screen.getByLabelText("Your result text")).toHaveTextContent(
      "My reviewed document.",
    );
  });

  it("initializes unmarked responses verbatim and resets only when the response changes", () => {
    const { rerender } = render(
      <StudioResultReview
        sourceText="Source."
        response={"  Full response.\n"}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit result" }));
    const editor = screen.getByRole("textbox", { name: "Your result text" });
    expect(editor).toHaveValue("  Full response.\n");
    fireEvent.change(editor, { target: { value: "Local edit" } });
    rerender(
      <StudioResultReview
        sourceText="Source revised."
        response={"  Full response.\n"}
      />,
    );
    expect(
      screen.getByRole("textbox", { name: "Your result text" }),
    ).toHaveValue("Local edit");
    rerender(
      <StudioResultReview
        sourceText="Source revised."
        response="New response."
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit result" }));
    expect(
      screen.getByRole("textbox", { name: "Your result text" }),
    ).toHaveValue("New response.");
  });

  it("treats HTML, scripts, images, and links as inert content", () => {
    const { container } = render(
      <StudioResultReview
        sourceText="Source"
        response={`# Result\n\n[Remote site](https://example.com/track)\n\n![tracking image](https://example.com/pixel.png)\n\n<script>window.resultExecuted=true</script>\n\n<iframe src="https://example.com/frame"></iframe>\n\n<img src="https://example.com/raw-image.png" onerror="alert(1)">`}
      />,
    );
    expect(container.querySelector("script,iframe,img,a[href]")).toBeNull();
    expect(screen.getByText("Remote site")).toBeInTheDocument();
    expect(screen.getByText("[Image: tracking image]")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Result" })).toBeInTheDocument();
  });

  it("limits rich rendering while copy preserves the complete result", async () => {
    const copy = vi.spyOn(clipboard, "copyText").mockResolvedValue("copied");
    const longResponse = `${"A ".repeat(RESULT_PREVIEW_LIMIT / 2)}TAIL_NOT_IN_PREVIEW`;
    render(<StudioResultReview sourceText="Source" response={longResponse} />);
    expect(
      screen.getByLabelText("Your result reading preview"),
    ).not.toHaveTextContent("TAIL_NOT_IN_PREVIEW");
    expect(screen.getByLabelText("Preview word counts")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy result" }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith(longResponse));
  });
});

describe("Markdown result download", () => {
  it("downloads exact text as Markdown with a fixed safe filename and revokes the URL", async () => {
    let blob!: Blob;
    vi.spyOn(URL, "createObjectURL").mockImplementation((value) => {
      blob = value as Blob;
      return "blob:result-download";
    });
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    let filename = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      filename = this.download;
    });
    const content = "# My result\n\n<script>Untrusted text</script>\n";
    expect(downloadStudioResult(content)).toBe(true);
    expect(blob.type).toBe("text/markdown;charset=utf-8");
    expect(filename).toBe("reword-nerd-result.md");
    const downloaded = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    expect(downloaded).toBe(content);
    await waitFor(() =>
      expect(revoke).toHaveBeenCalledWith("blob:result-download"),
    );
    expect(
      document.querySelector('a[download="reword-nerd-result.md"]'),
    ).toBeNull();
  });
});
