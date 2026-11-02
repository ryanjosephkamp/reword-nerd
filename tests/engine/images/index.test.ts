// The public entry point: it must load no heavy library until a file needs one.
const loaded = vi.hoisted(() => [] as string[]);

vi.mock("@zip.js/zip.js", () => {
  loaded.push("zip.js");
  return {};
});
vi.mock("pdfjs-dist", () => {
  loaded.push("pdf.js");
  return {};
});
vi.mock("tesseract.js", () => {
  loaded.push("Tesseract");
  return {};
});
vi.mock("mammoth", () => {
  loaded.push("mammoth");
  return {};
});

// A PNG header for 1 × 1 pixels; the stubbed browser decoder supplies the real size.
const PNG = Uint8Array.from(
  ("89504e470d0a1a0a" + "0000000d49484452" + "0000000100000001" + "08").match(/../gu) ?? [],
  (byte) => parseInt(byte, 16),
);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("images entry point", () => {
  it("imports without loading zip.js, pdf.js, Tesseract, or mammoth", async () => {
    const api = await import("../../../src/engine/images");
    expect(typeof api.readImageFiles).toBe("function");
    expect(loaded).toEqual([]);
  });

  it("reads an image through the browser decoder without loading any of them", async () => {
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 12, height: 34, close })),
    );
    const { readImageFiles, readImageFolder } = await import("../../../src/engine/images");
    const { images, rejected } = await readImageFiles(
      [new File([PNG], "a.png", { type: "image/png" })],
      { pdf: "both" },
    );
    expect(rejected).toEqual([]);
    expect(images[0]).toMatchObject({ name: "a.png", width: 12, height: 34, settings: null });
    expect(images[0].id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(close).toHaveBeenCalledOnce();

    const folder = await readImageFolder(
      [
        { file: new File([PNG, Uint8Array.of(2)], "b.png"), path: "Shots/b.png" },
        { file: new File([PNG, Uint8Array.of(1)], "a.png"), path: "Shots/a.png" },
      ],
      { pdf: "both" },
    );
    expect(folder.images.map(({ name }) => name)).toEqual(["Shots/a.png", "Shots/b.png"]);
    expect(loaded).toEqual([]);
  });

  it("exports the default settings and name check", async () => {
    const { DEFAULT_IMAGE_SETTINGS, isSupportedImageInputName, IMAGE_INPUT_ACCEPT } =
      await import("../../../src/engine/images");
    expect(DEFAULT_IMAGE_SETTINGS).toEqual({
      aspectRatio: "match-source",
      keepVisibleText: true,
      keepBackground: true,
      changes: "",
      mustKeep: "",
    });
    expect(Object.isFrozen(DEFAULT_IMAGE_SETTINGS)).toBe(true);
    expect(isSupportedImageInputName("Scan.PDF")).toBe(true);
    const accepted = IMAGE_INPUT_ACCEPT.split(",").map((extension) => `file${extension}`);
    expect(accepted.every((name) => isSupportedImageInputName(name))).toBe(true);
  });
});
