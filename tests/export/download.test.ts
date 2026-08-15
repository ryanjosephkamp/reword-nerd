import { afterEach, describe, expect, it, vi } from "vitest";
import { initiatePromptPackageDownload, initiateWorkbookProgressDownload } from "../../src/export";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("prompt-package download initiation", () => {
  it("removes the temporary anchor and revokes its URL when clicking fails", () => {
    // This catches a failed explicit download leaving a DOM node or object URL behind for the caller to clean up.
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:package"), revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => { throw new Error("blocked download"); });

    const result = initiatePromptPackageDownload(new Blob(["package"]));

    expect(result).toMatchObject({ ok: false, error: { code: "ARCHIVE_GENERATION_FAILED" } });
    expect(document.querySelector('a[href="blob:package"]')).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:package");
  });

  it("starts one explicit download and revokes its object URL after cleanup delay", () => {
    // This catches reuse of global navigation or leaked URLs after a successful user-initiated download.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T21:06:53.456Z"));
    const createObjectURL = vi.fn(() => "blob:package");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    expect(initiatePromptPackageDownload(new Blob(["package"]))).toEqual({ ok: true });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect((click.mock.instances[0] as HTMLAnchorElement).download)
      .toBe("reword-nerd-text-prompt-package-2026-08-14T21-06-53Z.zip");
    expect(document.querySelector('a[href="blob:package"]')).toBeNull();
    vi.advanceTimersByTime(100);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:package");
  });

  it("downloads progress HTML with its supplied safe filename through the same isolated adapter", () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => "blob:progress");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    expect(initiateWorkbookProgressDownload("<!doctype html><title>Progress</title>", "notes-progress.html")).toEqual({ ok: true });

    expect(createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: "text/html;charset=utf-8" }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector('a[download="notes-progress.html"]')).toBeNull();
    vi.advanceTimersByTime(100);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:progress");
  });
});
