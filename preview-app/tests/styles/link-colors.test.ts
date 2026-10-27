import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contrastRatio, cssRuleProperty } from "./css-contract";

describe("global workbench link color", () => {
  it("keeps every unvisited and visited anchor on the readable mint token", () => {
    // This catches Help, Info, footer, and rich-runbook links falling back to browser blue or purple.
    const css = readFileSync(join(process.cwd(), "src/styles/index.css"), "utf8");
    const linkColor = cssRuleProperty(css, "a:link, a:visited", "color");
    const mint = cssRuleProperty(css, ":root", "--color-ready");

    expect(linkColor).toBe("var(--color-ready)");
    expect(mint).toBe("#42e8b4");
    for (const backgroundToken of ["--color-canvas", "--color-surface", "--color-surface-raised"]) {
      const background = cssRuleProperty(css, ":root", backgroundToken);
      expect(background).toBeDefined();
      expect(contrastRatio(mint!, background!)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
