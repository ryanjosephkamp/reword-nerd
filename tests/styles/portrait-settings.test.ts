import { readFileSync } from "node:fs";
import { join } from "node:path";

function mobileSettingsContract(css: string): string {
  const match = css.match(/@media \(max-width: 767px\)[\s\S]*?\.parameters-panel\.is-mobile-active\s*\{([^}]+)\}[\s\S]*?\.settings-fields\s*\{([^}]+)\}/u);
  return match ? `${match[1]}\n${match[2]}` : "";
}

describe("portrait Settings layout contract", () => {
  it.each([320, 360, 390, 412])("keeps Settings independently scrollable above fixed navigation at %ipx", (width) => {
    // This catches the portrait panel growing behind Android chrome or the fixed bottom tabs at supported widths.
    const css = readFileSync(join(process.cwd(), "src/styles/workbench.css"), "utf8");
    const contract = mobileSettingsContract(css);

    expect(width).toBeLessThanOrEqual(767);
    expect(css).toMatch(/height:\s*100dvh/u);
    expect(contract).toMatch(/min-height:\s*0/u);
    expect(contract).toMatch(/height:\s*calc\(100dvh\s*-\s*72px\s*-\s*78px\s*-\s*env\(safe-area-inset-bottom\)\)/u);
    expect(contract).toMatch(/overflow-y:\s*auto/u);
    expect(contract).toMatch(/overscroll-behavior(?:-y)?:\s*contain/u);
    expect(contract).toMatch(/padding-bottom:\s*calc\([^;]*env\(safe-area-inset-bottom\)[^;]*\)/u);
  });

  it("stacks every modal backdrop above the fixed mobile navigation", () => {
    // This catches bottom tabs painting above a dialog and intercepting pointer input outside the focus trap.
    const css = readFileSync(join(process.cwd(), "src/styles/workbench.css"), "utf8");
    const backdrop = css.match(/\.drawer-backdrop,\s*\.dialog-backdrop\s*\{[^}]*z-index:\s*(\d+)/u);
    const tabs = css.match(/\.mobile-tabs\s*\{[^}]*z-index:\s*(\d+)/u);

    expect(backdrop?.[1]).toBeDefined();
    expect(tabs?.[1]).toBeDefined();
    expect(Number(backdrop?.[1])).toBeGreaterThan(Number(tabs?.[1]));
  });
});
