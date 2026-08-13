import { render, screen } from "@testing-library/react";

import MarkdownOriginalPreview from "../../src/app/workbench/components/MarkdownOriginalPreview";
import { JsonPreview, OriginalPreview, SafeHtmlPreview, parseDelimitedPreview } from "../../src/app/workbench/components/OriginalPreview";
import type { WorkspaceDocument } from "../../src/domain";

describe("safe ORIGINAL format renderers", () => {
  it("renders hostile HTML and Markdown without active elements or external requests", () => {
    // This catches uploaded markup becoming executable, navigable, or able to initiate a resource request.
    const { container, rerender } = render(<SafeHtmlPreview text={'<h2>Safe</h2><script>alert(1)</script><form action="https://evil.test/post"><input></form><a href="https://evil.test/a">visit</a><img src="https://evil.test/pixel.png" alt="tracking">'} />);
    expect(screen.getByRole("heading", { name: "Safe" })).toBeInTheDocument();
    expect(container.querySelector("script,style,form,input,iframe,object,embed,a,img,video,audio,source")).toBeNull();
    expect(screen.getByText("https://evil.test/a")).toBeInTheDocument();
    expect(screen.getByText("https://evil.test/pixel.png")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Copy URL" })).toHaveLength(2);

    rerender(<MarkdownOriginalPreview text={'# Safe markdown\n\n[visit](https://evil.test/a)\n\n![tracking](https://evil.test/pixel.png)\n\n<img src="https://evil.test/raw.png"><script>alert(1)</script>'} />);
    expect(container.querySelector("script,a,img,iframe,object,embed")).toBeNull();
    expect(screen.getByText("https://evil.test/a")).toBeInTheDocument();
    expect(screen.getByText("https://evil.test/pixel.png")).toBeInTheDocument();
  });

  it("keeps formula-like CSV cells as inert text and bounds rows and columns", () => {
    // This catches spreadsheet formulas being evaluated or unbounded tables exhausting the preview.
    const text = `name,value\nalpha,"=HYPERLINK(""https://evil.test"",""go"")"\nbeta,+CMD|' /C calc'!A0`;
    const preview = parseDelimitedPreview(text, ",");
    expect(preview.rows).toEqual([
      ["name", "value"],
      ["alpha", "=HYPERLINK(\"https://evil.test\",\"go\")"],
      ["beta", "+CMD|' /C calc'!A0"],
    ]);
    const huge = Array.from({ length: 220 }, (_, index) => `${index},${index}`).join("\n");
    expect(parseDelimitedPreview(huge, ",")).toMatchObject({ truncated: true });
    expect(parseDelimitedPreview(huge, ",").rows.length).toBe(200);
  });

  it("bounds an extreme JSON tree before recursion and treats prototype keys as data", () => {
    // This catches deeply nested input exhausting the render stack or prototype-looking keys being interpreted specially.
    const extreme = `${"[".repeat(5_000)}{"__proto__":"data","constructor":"also data"}${"]".repeat(5_000)}`;
    expect(() => render(<JsonPreview text={extreme} lines={false} />)).not.toThrow();
    expect(screen.getByText("Preview depth limit reached")).toBeInTheDocument();
  });

  it("bounds a wide JSON object to 2,000 rendered nodes and one truncation sentinel", () => {
    // This catches a zero budget being reused for every remaining key in a wide object.
    const wide = Object.fromEntries(Array.from({ length: 5_000 }, (_, index) => [`key-${index}`, index]));
    const { container } = render(<JsonPreview text={JSON.stringify(wide)} lines={false} />);
    expect(container.querySelectorAll(".json-key").length).toBeLessThanOrEqual(2_000);
    expect(screen.getAllByText("Preview limit reached")).toHaveLength(1);
    expect(container.querySelectorAll("li").length).toBeLessThanOrEqual(2_001);
  });

  it("uses reviewed local content for DOCX approximation without activating external relationships", async () => {
    // This catches a DOCX ORIGINAL surface injecting converter HTML or following package relationships.
    const original = new File([
      '<Relationship Target="https://evil.test/external.png" TargetMode="External"/>',
    ], "hostile.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const document = {
      kind: "document", id: "docx-1", original, originalByteSize: original.size, originalHash: "docx-hash",
      name: original.name, format: "docx", status: "needs-review", extractedText: "Reviewed local DOCX text",
      extractedTextHash: "reviewed-hash", warnings: [], requiresReview: true, settingsOverride: {},
      contextWarningAcknowledged: false,
    } satisfies WorkspaceDocument;
    const { container } = render(<OriginalPreview document={document} />);
    expect(await screen.findByLabelText("Approximate DOCX original")).toHaveTextContent("Reviewed local DOCX text");
    expect(container.querySelector("a,img,iframe,object,embed")).toBeNull();
  });
});
