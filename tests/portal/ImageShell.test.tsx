import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImageApp } from "../../src/image/ImageApp";
import { shareImageCanonicalUrl } from "../../src/image/share";

describe("Image portal shell", () => {
  it("hosts the local Image workbench while preserving Image identity and canonical links", () => {
    window.localStorage.setItem(
      "reword-nerd:image-preferences:v1",
      JSON.stringify({ version: 1, data: { tutorialVersion: "0.8" } }),
    );
    render(<ImageApp />);

    expect(screen.getByRole("main", { name: "reword_nerd Image workbench" })).toHaveTextContent("LOCAL SESSION");
    expect(screen.getByRole("link", { name: "IMAGE" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "Info" }));
    expect(screen.getByRole("img", { name: "Orange pyramid artwork" })).toHaveAttribute("src", "/image/orange-pyramid.webp");
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
