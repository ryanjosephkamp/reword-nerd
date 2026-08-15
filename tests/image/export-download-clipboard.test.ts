import {
  copyImagePrompt,
  copyImageSource,
  initiateImagePackageDownload,
} from "../../src/image/export";

describe("Image clipboard and deliberate download adapters", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("copies exact prompt text and reports unavailable or denied access truthfully", async () => {
    // Catches a copy control claiming success without writing the exact built prompt.
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await expect(copyImagePrompt("exact\nprompt")).resolves.toEqual({ ok: true });
    expect(writeText).toHaveBeenCalledWith("exact\nprompt");

    vi.stubGlobal("navigator", {});
    await expect(copyImagePrompt("prompt")).resolves.toEqual({ ok: false, reason: "unavailable" });

    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => { throw new DOMException("no", "NotAllowedError"); }) } });
    await expect(copyImagePrompt("prompt")).resolves.toEqual({ ok: false, reason: "denied" });
  });

  it("copies the already-rendered image as PNG and preserves truthful fallbacks", async () => {
    // Catches Copy Image using a network read or claiming success when conversion/permission fails.
    const png = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const image = document.createElement("img");
    Object.defineProperties(image, {
      naturalWidth: { value: 3 },
      naturalHeight: { value: 2 },
    });
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(png));
    class ClipboardItemDouble {
      constructor(readonly values: Record<string, Blob>) {}
    }
    const write = vi.fn(async (items: ClipboardItemDouble[]) => { void items; });
    vi.stubGlobal("ClipboardItem", ClipboardItemDouble);
    vi.stubGlobal("navigator", { clipboard: { write } });
    await expect(copyImageSource(new Blob([new Uint8Array([9])], { type: "image/jpeg" }), image)).resolves.toEqual({ ok: true });
    expect(drawImage).toHaveBeenCalledWith(image, 0, 0, 3, 2);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]?.[0]?.values).toEqual({ "image/png": png });

    vi.stubGlobal("ClipboardItem", undefined);
    await expect(copyImageSource(png, image)).resolves.toEqual({ ok: false, reason: "unavailable" });

    vi.stubGlobal("ClipboardItem", ClipboardItemDouble);
    vi.stubGlobal("navigator", { clipboard: { write: vi.fn(async () => { throw new DOMException("no", "NotAllowedError"); }) } });
    await expect(copyImageSource(png, image)).resolves.toEqual({ ok: false, reason: "denied" });

    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(null));
    vi.stubGlobal("navigator", { clipboard: { write } });
    await expect(copyImageSource(png, image)).resolves.toEqual({ ok: false, reason: "conversion-failed" });
  });

  it("initiates exactly one explicit ZIP download and revokes its owned URL", () => {
    // Catches Build auto-downloading, a wrong filename, or a leaked download URL.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T21:06:53.456Z"));
    const createObjectURL = vi.fn((source: Blob) => { void source; return "blob:image-package"; });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    expect(click).not.toHaveBeenCalled();

    const packageBytes = new Blob([new Uint8Array([80, 75])], { type: "application/zip" });
    expect(initiateImagePackageDownload(packageBytes)).toEqual({ ok: true });
    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("reword-nerd-image-prompt-package-2026-08-14T21-06-53Z.zip");
    expect(anchor.href).toBe("blob:image-package");
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:image-package");
  });

  it("refuses malformed ZIP input without creating a URL or clicking", () => {
    // Catches the download boundary accepting an empty or wrong-type Blob.
    const createObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    expect(initiateImagePackageDownload(new Blob([], { type: "application/zip" }))).toEqual({
      ok: false,
      message: "The local Image package is not available for download.",
    });
    expect(initiateImagePackageDownload(new Blob(["x"], { type: "text/plain" }))).toEqual({
      ok: false,
      message: "The local Image package is not available for download.",
    });
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });
});
