import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImageApp } from "../../src/image/ImageApp";
import { shareImageCanonicalUrl } from "../../src/image/share";

describe("Image portal shell", () => {
  it("identifies Image with the supplied artwork while leaving the workbench for later tasks", () => {
    // This catches the new physical entry being a duplicate Text app or prematurely claiming Image workbench functionality.
    render(<ImageApp />);

    expect(screen.getByRole("main", { name: "reword_nerd Image portal" })).toHaveTextContent("IMAGE WORKBENCH ARRIVING NEXT");
    expect(screen.getByRole("link", { name: "IMAGE" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("img", { name: "Orange pyramid artwork" })).toHaveAttribute("src", "/image/orange-pyramid.webp");
    fireEvent.click(screen.getByRole("button", { name: "Info" }));
    expect(screen.getByRole("link", { name: "Updates" })).toHaveAttribute("href", "/updates/v0-7-0/");
    expect(screen.getByRole("link", { name: "Community" })).toHaveAttribute("href", "https://github.com/ryanjosephkamp/reword-nerd/issues/new?template=bug_report.yml");
  });

  it("shares only the clean canonical Image URL", async () => {
    // This catches Image sharing a query, hash, or root Text URL.
    const nativeShare = vi.fn().mockResolvedValue(undefined);

    await expect(shareImageCanonicalUrl({ nativeShare })).resolves.toBe("shared");
    expect(nativeShare).toHaveBeenCalledWith({ title: "reword-nerd Image", url: "https://ryanjosephkamp.github.io/reword-nerd/image/" });
  });
});
