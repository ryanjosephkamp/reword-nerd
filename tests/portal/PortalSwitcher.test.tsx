import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PortalSwitcher } from "../../src/app/portal/PortalSwitcher";
import { canonicalPortalUrl, portalHref } from "../../src/app/portal/portalUrls";

describe("portal switching", () => {
  it("creates the clean Image canonical URL and base-path-safe portal hrefs", () => {
    // This catches Image sharing the mutable current URL or dropping the Pages base path.
    expect(portalHref("text", "/reword-nerd/")).toBe("/reword-nerd/");
    expect(portalHref("image", "/reword-nerd/")).toBe("/reword-nerd/image/");
    expect(canonicalPortalUrl("image")).toBe("https://ryanjosephkamp.github.io/reword-nerd/image/");
  });

  it("navigates directly to Image when the Text session has no work", () => {
    // This catches a clean session being forced through a destructive confirmation flow.
    const navigate = vi.fn();
    render(<PortalSwitcher currentPortal="text" hasSessionWork={false} onClearSession={vi.fn()} onNavigate={navigate} basePath="/reword-nerd/" />);

    const image = screen.getByRole("link", { name: "IMAGE" });
    expect(image).toHaveAttribute("href", "/reword-nerd/image/");
    fireEvent.click(image);

    expect(navigate).toHaveBeenCalledWith("/reword-nerd/image/");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps a Text session intact until the user chooses one of the two guarded switch paths", () => {
    // This catches portal navigation silently clearing current in-memory work.
    const navigate = vi.fn();
    const clearSession = vi.fn();
    const openNewTab = vi.fn();
    render(<PortalSwitcher
      currentPortal="text"
      hasSessionWork
      onClearSession={clearSession}
      onNavigate={navigate}
      onOpenNewTab={openNewTab}
      basePath="/reword-nerd/"
    />);

    fireEvent.click(screen.getByRole("link", { name: "IMAGE" }));
    const dialog = screen.getByRole("dialog", { name: "Switch to Image?" });
    const choices = within(dialog).getAllByRole("button", { name: /Open Image in a new tab|Clear Text session and open Image/ });
    expect(choices).toHaveLength(2);
    expect(clearSession).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Open Image in a new tab" }));
    expect(openNewTab).toHaveBeenCalledWith("/reword-nerd/image/");
    expect(clearSession).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("link", { name: "IMAGE" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear Text session and open Image" }));
    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/reword-nerd/image/");
  });

  it("marks the active portal for assistive technology and keeps focus contained in its confirmation", () => {
    // This catches an ambiguous active portal or Tab escaping the session-preservation decision.
    render(<PortalSwitcher currentPortal="image" hasSessionWork onClearSession={vi.fn()} basePath="/reword-nerd/" />);

    expect(screen.getByRole("link", { name: "IMAGE" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "TEXT" })).not.toHaveAttribute("aria-current");
    fireEvent.click(screen.getByRole("link", { name: "TEXT" }));
    const dialog = screen.getByRole("dialog", { name: "Switch to Text?" });
    const lastChoice = within(dialog).getByRole("button", { name: "Clear Image session and open Text" });
    lastChoice.focus();
    fireEvent.keyDown(lastChoice, { key: "Tab" });
    expect(within(dialog).getByRole("button", { name: "Close portal switch confirmation" })).toHaveFocus();
  });

  it("keeps trigger focus custody across initial focus, both Tab boundaries, and dismissal", async () => {
    // This catches a portal confirmation that strands keyboard users after they cancel a session-preserving switch.
    render(<PortalSwitcher currentPortal="text" hasSessionWork onClearSession={vi.fn()} basePath="/reword-nerd/" />);

    const trigger = screen.getByRole("link", { name: "IMAGE" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Switch to Image?" });
    const close = within(dialog).getByRole("button", { name: "Close portal switch confirmation" });
    const firstChoice = within(dialog).getByRole("button", { name: "Open Image in a new tab" });
    const lastChoice = within(dialog).getByRole("button", { name: "Clear Text session and open Image" });

    expect(firstChoice).toHaveFocus();
    close.focus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(lastChoice).toHaveFocus();
    fireEvent.keyDown(lastChoice, { key: "Tab" });
    expect(close).toHaveFocus();

    fireEvent.click(close);
    await waitFor(() => expect(trigger).toHaveFocus());

    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Switch to Image?" }), { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
