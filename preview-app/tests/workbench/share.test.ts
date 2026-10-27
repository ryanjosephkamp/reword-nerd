import { describe, expect, it, vi } from "vitest";
import { CANONICAL_WORKBENCH_URL, shareCanonicalUrl } from "../../src/app/workbench/share";

describe("canonical sharing", () => {
  it("shares the immutable production workbench URL through native Share", async () => {
    // This catches a Share action leaking the local/session URL or bypassing native sharing when available.
    const nativeShare = vi.fn(async () => undefined);
    const copy = vi.fn(async () => "copied" as const);

    await expect(shareCanonicalUrl({ nativeShare, copy })).resolves.toBe("shared");
    expect(nativeShare).toHaveBeenCalledWith({ title: "reword-nerd", url: "https://ryanjosephkamp.github.io/reword-nerd/" });
    expect(copy).not.toHaveBeenCalled();
    expect(CANONICAL_WORKBENCH_URL).toBe("https://ryanjosephkamp.github.io/reword-nerd/");
  });

  it("keeps a native Share cancellation silent without attempting clipboard fallback", async () => {
    // This catches cancellation being misreported as a failure or a second share path.
    const nativeShare = vi.fn(async () => { throw new DOMException("closed", "AbortError"); });
    const copy = vi.fn(async () => "copied" as const);

    await expect(shareCanonicalUrl({ nativeShare, copy })).resolves.toBe("cancelled");
    expect(copy).not.toHaveBeenCalled();
  });

  it("uses clipboard then manual selection only when native Share is unavailable or fails", async () => {
    // This catches a non-cancel share failure dropping the user with no usable URL.
    const failedShare = vi.fn(async () => { throw new Error("unsupported"); });
    const copied = vi.fn(async () => "copied" as const);
    const manual = vi.fn(async () => "select-manually" as const);

    await expect(shareCanonicalUrl({ nativeShare: failedShare, copy: copied })).resolves.toBe("copied");
    await expect(shareCanonicalUrl({ copy: manual })).resolves.toBe("manual");
    expect(copied).toHaveBeenCalledWith("https://ryanjosephkamp.github.io/reword-nerd/");
    expect(manual).toHaveBeenCalledWith("https://ryanjosephkamp.github.io/reword-nerd/");
  });
});
