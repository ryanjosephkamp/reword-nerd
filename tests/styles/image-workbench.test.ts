import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cssRuleProperty } from "./css-contract";

describe("scoped Image workbench visual contract", () => {
  const css = readFileSync(join(process.cwd(), "src/styles/image-workbench.css"), "utf8");

  it("keeps Image action/review identity scoped without replacing Text ready teal", () => {
    expect(cssRuleProperty(css, ".image-workbench", "--image-action")).toBe("#ff9f1c");
    expect(cssRuleProperty(css, ".image-workbench", "--image-review")).toBe("#ffd166");
    expect(css).not.toMatch(/:root\s*\{/u);
    expect(css).not.toMatch(/--color-ready\s*:/u);
    expect(cssRuleProperty(css, ".image-workbench .portal-link-text, .image-workbench .portal-link-text:visited", "color"))
      .toBe("var(--color-ready)");
    expect(cssRuleProperty(css, ".image-workbench a, .image-workbench a:visited", "color"))
      .toBe("var(--image-action)");
  });

  it("uses visible orange focus and a yellow review border plus textual state", () => {
    expect(cssRuleProperty(css, ".image-workbench :is(a, button, input, select, textarea):focus-visible", "outline"))
      .toContain("var(--image-action)");
    expect(cssRuleProperty(css, ".image-workbench .image-review-state", "color")).toBe("var(--image-review)");
    expect(cssRuleProperty(css, ".image-workbench .image-ocr-needs-review", "border-left"))
      .toContain("var(--image-review)");
    expect(css).toMatch(/\.image-review-state/u);
  });

  it("defines independent desktop panels, tablet drawer, and safe mobile navigation", () => {
    expect(cssRuleProperty(css, ".image-workbench-grid", "overflow")).toBe("hidden");
    expect(cssRuleProperty(css, ".image-workbench .image-panel", "overflow")).toBe("auto");
    expect(css).toMatch(/@media \(min-width: 1280px\)/u);
    expect(css).toMatch(/@media \(min-width: 768px\) and \(max-width: 1279px\)/u);
    expect(css).toMatch(/@media \(max-width: 767px\)/u);
    expect(css).toMatch(/\.image-mobile-tabs\s*\{[^}]*position:\s*fixed/su);
    expect(css).toMatch(/padding-bottom:[^;]*env\(safe-area-inset-bottom\)/u);
    expect(css).toMatch(/\.image-workbench :is\(input, select, textarea, button\)\s*\{[^}]*font-size:\s*16px/su);
    expect(css).toMatch(/overscroll-behavior(?:-y)?:\s*contain/u);
  });

  it("honors reduced motion inside Image only", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.image-workbench \*/u);
    expect(css).toMatch(/transition-duration:\s*\.01ms/u);
  });
});
