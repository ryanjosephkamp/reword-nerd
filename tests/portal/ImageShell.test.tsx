import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageApp } from "../../src/image/ImageApp";
import { CANONICAL_IMAGE_URL, shareImageCanonicalUrl } from "../../src/image/share";

const imagePreferences = JSON.stringify({ version: 1, data: { tutorialVersion: "0.8-image-quick-start" } });

afterEach(() => vi.unstubAllGlobals());

describe("Image portal shell", () => {
  it("hosts the local Image workbench while preserving Image identity and canonical links", () => {
    window.localStorage.setItem(
      "reword-nerd:image-preferences:v1",
      imagePreferences,
    );
    render(<ImageApp />);

    expect(screen.getByRole("main", { name: "reword_nerd Image workbench" })).toHaveTextContent("LOCAL SESSION");
    expect(screen.getByRole("link", { name: "IMAGE" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "Info" }));
    expect(screen.getByRole("img", { name: "Orange pyramid artwork" })).toHaveAttribute("src", "/image/orange-pyramid.webp");
  });

  it("retains the exact allowlisted site-wide product, community, and creator destinations", () => {
    window.localStorage.setItem("reword-nerd:image-preferences:v1", imagePreferences);
    render(<ImageApp />);
    fireEvent.click(screen.getByRole("button", { name: "Info" }));
    const info = screen.getByRole("dialog", { name: "About reword-nerd Image" });
    const expectedLinks = [
      ["Updates", "/updates/v0-7-0/"],
      ["Repository", "https://github.com/ryanjosephkamp/reword-nerd"],
      ["Report a bug", "https://github.com/ryanjosephkamp/reword-nerd/issues/new?template=bug_report.yml"],
      ["Suggest a feature", "https://github.com/ryanjosephkamp/reword-nerd/issues/new?template=feature_request.yml"],
      ["Security reporting", "https://github.com/ryanjosephkamp/reword-nerd/security/advisories/new"],
      ["GitHub profile", "https://github.com/ryanjosephkamp/"],
      ["Website", "https://ryanjosephkamp.github.io"],
      ["Sponsor", "https://github.com/sponsors/ryanjosephkamp"],
    ] as const;

    expect(within(info).getAllByRole("link").map((link) => link.textContent)).toEqual(expectedLinks.map(([name]) => name));
    for (const [name, href] of expectedLinks) {
      expect(within(info).getByRole("link", { name })).toHaveAttribute("href", href);
    }
  });

  it("shows and selects the canonical URL when automated Image sharing is unavailable", async () => {
    // Removing the visible dialog or replacing it with live-region-only text must make this fail.
    vi.stubGlobal("isSecureContext", false);
    window.localStorage.setItem("reword-nerd:image-preferences:v1", imagePreferences);
    render(<ImageApp />);
    const trigger = screen.getByRole("button", { name: "Share" });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "Share link" });
    const url = within(dialog).getByRole("textbox", { name: "Share URL" }) as HTMLTextAreaElement;
    expect(url).toBeVisible();
    expect(url).toHaveValue(CANONICAL_IMAGE_URL);
    await waitFor(() => expect(url).toHaveFocus());
    expect(url.selectionStart).toBe(0);
    expect(url.selectionEnd).toBe(CANONICAL_IMAGE_URL.length);

    fireEvent.click(within(dialog).getByRole("button", { name: "Close share link" }));
    expect(trigger).toHaveFocus();
  });

  it("shares only the clean canonical Image URL", async () => {
    // This catches Image sharing a query, hash, or root Text URL.
    const nativeShare = vi.fn().mockResolvedValue(undefined);

    await expect(shareImageCanonicalUrl({ nativeShare })).resolves.toBe("shared");
    expect(nativeShare).toHaveBeenCalledWith({ title: "reword-nerd Image", url: "https://ryanjosephkamp.github.io/reword-nerd/image/" });
  });
});
