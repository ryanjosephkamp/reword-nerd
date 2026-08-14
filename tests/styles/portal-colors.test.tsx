import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ImageApp } from "../../src/image/ImageApp";

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

  it("uses orange links and keyboard focus throughout the Image shell without recoloring Text", () => {
    // This catches Image controls inheriting the global teal link/focus treatment or the shared Text portal losing teal identity.
    const stylesheet = document.createElement("style");
    stylesheet.textContent = `${readFileSync("src/styles/index.css", "utf8")}\n${readFileSync("src/styles/workbench.css", "utf8")}`;
    document.head.append(stylesheet);
    render(<ImageApp />);

    const textPortal = screen.getByRole("link", { name: "TEXT" });
    const imagePortal = screen.getByRole("link", { name: "IMAGE" });
    fireEvent.click(screen.getByRole("button", { name: "Info" }));
    const updates = screen.getByRole("link", { name: "Updates" });
    const community = screen.getByRole("link", { name: "Community" });

    expect(getComputedStyle(textPortal).color).toBe("var(--color-ready)");
    expect(getComputedStyle(imagePortal).color).toBe("rgb(255, 159, 28)");
    expect(getComputedStyle(updates).color).toBe("rgb(255, 159, 28)");
    expect(getComputedStyle(community).color).toBe("rgb(255, 159, 28)");

    stylesheet.remove();
  });
});
