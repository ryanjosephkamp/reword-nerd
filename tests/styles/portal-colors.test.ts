import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("portal navigation colors", () => {
  it("keeps Text teal and Image orange for portal links", () => {
    // This catches the global teal link rule erasing Image identity.
    const stylesheet = document.createElement("style");
    stylesheet.textContent = `${readFileSync("src/styles/index.css", "utf8")}\n${readFileSync("src/styles/workbench.css", "utf8")}`;
    document.head.append(stylesheet);
    const text = document.createElement("a");
    const image = document.createElement("a");
    text.className = "portal-link portal-link-text";
    image.className = "portal-link portal-link-image";
    text.href = "/";
    image.href = "/image/";
    document.body.append(text, image);

    expect(getComputedStyle(text).color).toBe("var(--color-ready)");
    expect(getComputedStyle(image).color).toBe("rgb(255, 159, 28)");

    text.remove();
    image.remove();
    stylesheet.remove();
  });
});
