import { loadOnce } from "../../../src/engine/lazy";

describe("loadOnce", () => {
  it("reuses a successful load", async () => {
    const load = vi.fn(async () => ({ ready: true }));
    const get = loadOnce(load);
    expect(await get()).toBe(await get());
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("tries again after a failed load instead of failing until reload", async () => {
    // Catches a dropped chunk download breaking PDFs for the rest of the session.
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("chunk failed"))
      .mockResolvedValue("pdfjs");
    const get = loadOnce(load);
    await expect(get()).rejects.toThrow("chunk failed");
    expect(await get()).toBe("pdfjs");
    expect(load).toHaveBeenCalledTimes(2);
  });
});
