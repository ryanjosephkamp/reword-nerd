import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PAPER_COLORS } from "../../../src/engine/page/look";

const css = readFileSync("src/styles/page.css", "utf8");

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  return css.slice(start, css.indexOf("}", start));
}

describe("PAPER_COLORS", () => {
  it("matches the page styles, so Word files look like the page", () => {
    for (const [paper, colors] of Object.entries(PAPER_COLORS)) {
      const rules = block(paper === "paper" ? ".page" : `.page[data-style="${paper}"]`);
      expect(rules).toContain(`--page-bg: ${colors.bg};`);
      expect(rules).toContain(`--page-ink: ${colors.ink};`);
      expect(rules).toContain(`--page-muted: ${colors.muted};`);
      expect(rules).toContain(`--page-line: ${colors.line};`);
    }
  });
});
