import { describe, expect, it } from "vitest";
import { auditVerdict, parseReply } from "../../../src/engine/results/parse";

describe("parseReply", () => {
  it("reads the document and audit blocks", () => {
    const reply = [
      "<<<FINAL_DOCUMENT>>>",
      "# Gardens",
      "",
      "Neighbors meet in gardens.",
      "<<<END_FINAL_DOCUMENT>>>",
      "",
      "<<<FIDELITY_AUDIT>>>",
      "Meaning: PASS — all claims kept",
      "<<<END_FIDELITY_AUDIT>>>",
    ].join("\n");
    const parsed = parseReply(reply);
    expect(parsed.document).toBe("# Gardens\n\nNeighbors meet in gardens.");
    expect(parsed.audit).toBe("Meaning: PASS — all claims kept");
    expect(parsed.unstructured).toBe(false);
  });

  it("removes a code fence wrapped around the whole reply", () => {
    const parsed = parseReply("```text\n<<<FINAL_DOCUMENT>>>\nHi.\n<<<END_FINAL_DOCUMENT>>>\n```");
    expect(parsed.document).toBe("Hi.");
  });

  it("reads file blocks for multi-file jobs", () => {
    const reply =
      "<<<FILE a.md>>>\nA\n<<<END_FILE>>>\n<<<FILE src/b.py>>>\n# B\nx = 1\n<<<END_FILE>>>";
    expect(parseReply(reply).files).toEqual([
      { path: "a.md", text: "A" },
      { path: "src/b.py", text: "# B\nx = 1" },
    ]);
  });

  it("takes an unformatted reply as the document", () => {
    const parsed = parseReply("  Just the rewritten text.  ");
    expect(parsed).toMatchObject({ document: "Just the rewritten text.", unstructured: true });
  });
});

describe("auditVerdict", () => {
  it("flags any REVIEW line", () => {
    expect(auditVerdict("Meaning: PASS\nSettings: REVIEW — longer than asked")).toBe("review");
    expect(auditVerdict("Meaning: PASS\nSettings: PASS")).toBe("pass");
    expect(auditVerdict(null)).toBe("unknown");
  });
});
