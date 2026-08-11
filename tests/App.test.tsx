import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { App } from "../src/app/App";

describe("application scaffold", () => {
  it("mounts the accessible workbench landmark", () => {
    render(<App />);

    expect(screen.getByRole("main", { name: "reword_nerd workbench" })).toBeInTheDocument();
  });

  it("exposes the complete approved Night Terminal palette as CSS tokens", () => {
    const stylesheet = document.createElement("style");
    stylesheet.textContent = readFileSync("src/styles/index.css", "utf8");
    document.head.append(stylesheet);

    const styles = getComputedStyle(document.documentElement);

    expect(styles.getPropertyValue("--color-canvas").trim()).toBe("#090b10");
    expect(styles.getPropertyValue("--color-surface").trim()).toBe("#11151d");
    expect(styles.getPropertyValue("--color-surface-raised").trim()).toBe("#171c25");
    expect(styles.getPropertyValue("--color-border").trim()).toBe("#303746");
    expect(styles.getPropertyValue("--color-text").trim()).toBe("#d7dde8");
    expect(styles.getPropertyValue("--color-muted").trim()).toBe("#7f8a9d");
    expect(styles.getPropertyValue("--color-ready").trim()).toBe("#42e8b4");
    expect(styles.getPropertyValue("--color-review").trim()).toBe("#f2b84b");
    expect(styles.getPropertyValue("--color-blocked").trim()).toBe("#ff667a");

    stylesheet.remove();
  });

  it("allows the narrow compact status summary to wrap without clipping counts", () => {
    const css = readFileSync("src/styles/workbench.css", "utf8");

    expect(css).toMatch(/\.status-summary\.compact\s*\{[^}]*flex-wrap:\s*wrap;/su);
  });
});
