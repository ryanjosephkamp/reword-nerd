import { PdfPasswordError } from "../../../src/engine/pdf";
import { openZipArchive } from "../../../src/engine/zip";
import { IMAGE_LIMITS } from "../../../src/engine/images/limits";
import type { PdfImageData, PdfOpener, PdfPage } from "../../../src/engine/images/pdfImages";
import {
  folderInputs,
  readImages,
  type ImageInput,
  type ImageReaderAdapters,
  type ReadImagesOptions,
} from "../../../src/engine/images/reader";
import type { Progress } from "../../../src/engine/types";
import {
  docxBytes,
  emfBytes,
  fakeDecoder,
  gifBytes,
  jpegBytes,
  pngBytes,
  zipBytes,
} from "../../fixtures/images/samples";

const text = new TextEncoder();

function rgb(width: number, height: number, fill = 1): PdfImageData {
  return { width, height, kind: 2, data: new Uint8Array(width * height * 3).fill(fill) };
}

/** A PDF whose pages paint the given inline pictures; page captures are distinct PNGs. */
function pdfOpener(pages: PdfImageData[][], error?: Error): PdfOpener {
  const noObjects = { get: () => null };
  return async () => {
    if (error) throw error;
    return {
      numPages: pages.length,
      getPage: async (pageNumber): Promise<PdfPage> => ({
        getOperatorList: async () => ({
          fnArray: pages[pageNumber - 1].map(() => 86),
          argsArray: pages[pageNumber - 1].map((image) => [image]),
        }),
        objs: noObjects,
        commonObjs: noObjects,
        getViewport: ({ scale }) => ({ width: 612 * scale, height: 792 * scale }),
        cleanup: () => undefined,
      }),
      renderPage: async (pageNumber) => new Blob([pngBytes({ seed: 5_000 + pageNumber })]),
      destroy: async () => undefined,
    };
  };
}

function adapters(overrides: Partial<ImageReaderAdapters> = {}): ImageReaderAdapters {
  let next = 0;
  return {
    decode: fakeDecoder,
    openZip: openZipArchive,
    openPdf: pdfOpener([]),
    encodePdfImage: async ({ width, height, data }) =>
      new Blob([`${width}x${height}:${data?.[0]}`], { type: "image/png" }),
    createId: () => `image-${(next += 1)}`,
    ...overrides,
  };
}

function input(name: string, bytes: Uint8Array<ArrayBuffer>): ImageInput {
  return { name, file: new File([bytes], name) };
}

function read(
  inputs: ImageInput[],
  options: Partial<ReadImagesOptions> = {},
  overrides: Partial<ImageReaderAdapters> = {},
) {
  return readImages(inputs, { pdf: "embedded-images", ...options }, adapters(overrides));
}

describe("readImages", () => {
  it("adds supported images and explains every file it can't add", async () => {
    const zip = await zipBytes([
      ["b/anim.gif", gifBytes()],
      ["a/one.png", pngBytes({ seed: 1 })],
      ["c/inner.zip", await zipBytes([["x.png", pngBytes({ seed: 9 })]])],
      ["d/readme.txt", text.encode("hello")],
      ["e/broken.png", pngBytes({ seed: 2, broken: true })],
      ["__MACOSX/a/._one.png", text.encode("resource fork")],
      [".DS_Store", text.encode("finder")],
    ]);
    const { images, rejected } = await read([
      input("photo.png", pngBytes({ width: 320, height: 200 })),
      input("art.gif", gifBytes()),
      input("notes.txt", text.encode("notes")),
      input("bundle.zip", zip),
      input("empty.png", new Uint8Array(0)),
      input("fake.pdf", pngBytes({ seed: 3 })),
    ]);

    expect(images).toEqual([
      {
        id: "image-1",
        kind: "image",
        name: "photo.png",
        from: null,
        original: expect.any(Blob),
        mimeType: "image/png",
        width: 320,
        height: 200,
        byteCount: 27,
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
        included: true,
        visibleText: "",
        settings: null,
        notes: [],
      },
      expect.objectContaining({ name: "a/one.png", from: { container: "bundle.zip" } }),
    ]);
    expect(rejected).toEqual([
      {
        name: "art.gif",
        reason: "GIF images aren't supported. Save it as PNG or JPEG and add it again.",
      },
      { name: "notes.txt", reason: expect.stringMatching(/^This type of file isn't supported/u) },
      { name: "bundle.zip/b/anim.gif", reason: expect.stringMatching(/^GIF images/u) },
      {
        name: "bundle.zip/c/inner.zip",
        reason: "ZIP files inside a ZIP aren't opened. Unzip it and add its files instead.",
      },
      { name: "bundle.zip/d/readme.txt", reason: expect.stringMatching(/isn't supported/u) },
      {
        name: "bundle.zip/e/broken.png",
        reason: "This image couldn't be opened. It may be damaged or incomplete.",
      },
      { name: "empty.png", reason: "This file is empty." },
      { name: "fake.pdf", reason: "This file isn't a valid PDF." },
    ]);
  });

  it("checks names and sizes before reading a file", async () => {
    const arrayBuffer = vi.fn();
    const huge = { size: 21 * 1024 * 1024, type: "", arrayBuffer } as unknown as Blob;
    const { rejected } = await read([
      { name: "huge.png", file: huge },
      { name: "huge.pdf", file: { ...huge, size: 101 * 1024 * 1024 } as Blob },
      { name: "movie.mov", file: huge },
    ]);
    expect(rejected.map(({ reason }) => reason)).toEqual([
      "This file is 21 MB; the limit is 20 MB.",
      "This file is 101 MB; the limit is 100 MB.",
      expect.stringMatching(/^This type of file isn't supported/u),
    ]);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("adds a repeated picture once and says where the copies were", async () => {
    const same = pngBytes({ seed: 7 });
    const { images, rejected } = await read([
      input("photo.png", same),
      input("copy.png", same),
      input("bundle.zip", await zipBytes([["dup.png", same]])),
    ]);
    expect(rejected).toEqual([]);
    expect(images.map(({ name }) => name)).toEqual(["photo.png"]);
    expect(images[0].notes).toEqual([
      "Found 2 more copies of this picture (copy.png; bundle.zip/dup.png); it was added once.",
    ]);
  });

  it("notes when a file's content doesn't match its name", async () => {
    const { images } = await read([input("download.png", jpegBytes())]);
    expect(images[0]).toMatchObject({ mimeType: "image/jpeg" });
    expect(images[0].notes[0]).toMatch(/is a JPEG image even though its name ends in \.png/u);
  });

  it("takes pictures from a Word file inside a ZIP, in document order", async () => {
    const docx = await docxBytes({
      media: [
        ["image1.png", pngBytes({ width: 400, height: 300, seed: 1 })],
        ["image2.emf", emfBytes()],
        ["image3.png", pngBytes({ width: 40, height: 40, seed: 3 })],
      ],
      bodyOrder: ["image3.png", "image2.emf", "image1.png"],
    });
    const zip = await zipBytes([["docs/report.docx", docx]]);
    const { images, rejected } = await read([input("bundle.zip", zip)]);
    expect(rejected).toEqual([]);
    const container = "bundle.zip/docs/report.docx";
    expect(images).toEqual([
      expect.objectContaining({ name: "image3.png", from: { container }, width: 40 }),
      expect.objectContaining({ name: "image1.png", from: { container }, notes: [] }),
    ]);
    expect(images[0].notes).toEqual([
      "This picture is small and may be decorative.",
      `${container}: left out 1 picture (format not supported: EMF).`,
    ]);
  });

  it("rejects a Word file with nothing usable, saying why", async () => {
    const { rejected } = await read([
      input("empty.docx", await docxBytes({ media: [] })),
      input("drawings.docx", await docxBytes({ media: [["image1.wmf", emfBytes()]] })),
      input("fake.docx", pngBytes()),
    ]);
    expect(rejected).toEqual([
      { name: "empty.docx", reason: "This Word file has no pictures." },
      {
        name: "drawings.docx",
        reason: "No usable pictures were found. Left out 1 picture (format not supported: EMF).",
      },
      { name: "fake.docx", reason: "This file isn't a valid Word (.docx) file." },
    ]);
  });

  it("takes embedded PDF pictures and notes the ones left out", async () => {
    const openPdf = pdfOpener([[rgb(120, 90, 1), rgb(10, 10, 2)], [rgb(200, 200, 3)]]);
    const { images } = await read([input("scan.pdf", text.encode("%PDF-1.7"))], {}, { openPdf });
    expect(images).toEqual([
      expect.objectContaining({
        name: "page-1-image-1.png",
        from: { container: "scan.pdf", pageNumber: 1 },
        mimeType: "image/png",
        width: 120,
        height: 90,
      }),
      expect.objectContaining({ name: "page-2-image-1.png", notes: [] }),
    ]);
    expect(images[0].notes).toEqual([
      "scan.pdf: left out 1 picture (too small to use, under 32 pixels on a side).",
    ]);
  });

  it("explains a PDF that gives nothing", async () => {
    const pdf = text.encode("%PDF-1.7");
    const none = await read([input("text-only.pdf", pdf)], {}, { openPdf: pdfOpener([[]]) });
    expect(none.rejected[0].reason).toBe(
      "This PDF has no pictures to take out. Try capturing whole pages instead.",
    );
    const tiny = await read([input("dots.pdf", pdf)], {}, { openPdf: pdfOpener([[rgb(4, 4)]]) });
    expect(tiny.rejected[0].reason).toBe(
      "No usable pictures were found. Left out 1 picture (too small to use, under 32 pixels on a side).",
    );
    const locked = await read(
      [input("locked.pdf", pdf)],
      {},
      { openPdf: pdfOpener([], new PdfPasswordError()) },
    );
    expect(locked.rejected).toEqual([
      {
        name: "locked.pdf",
        reason: "This PDF is password-protected. Remove the password and add it again.",
      },
    ]);
  });

  it("captures PDF pages when asked", async () => {
    const openPdf = pdfOpener([[rgb(100, 100)], []]);
    const pdf = input("deck.pdf", text.encode("%PDF-1.7"));
    const { images } = await read([pdf], { pdf: "page-captures" }, { openPdf });
    expect(images).toEqual([
      expect.objectContaining({ name: "page-1.png", width: 1275, height: 1650 }),
      expect.objectContaining({
        name: "page-2.png",
        from: { container: "deck.pdf", pageNumber: 2 },
      }),
    ]);
    expect(images[0].notes).toEqual(["A capture of the whole page."]);
    const both = await read([pdf], { pdf: "both" }, { openPdf });
    expect(both.images.map(({ name }) => name)).toEqual([
      "page-1.png",
      "page-1-image-1.png",
      "page-2.png",
    ]);
  });

  it("stops at 100 images and says so", async () => {
    const inputs = Array.from({ length: 101 }, (_, index) =>
      input(`photo-${index}.png`, pngBytes({ seed: index })),
    );
    inputs.push(input("late.pdf", text.encode("%PDF-1.7")));
    const { images, rejected } = await read(inputs);
    expect(images).toHaveLength(IMAGE_LIMITS.maxImagesPerBatch);
    const reason = "Not added: the limit of 100 images at a time was reached.";
    expect(rejected).toEqual([
      { name: "photo-100.png", reason },
      { name: "late.pdf", reason },
    ]);
  });

  it("notes where a PDF stopped when the batch filled up", async () => {
    const photos = Array.from({ length: 95 }, (_, index) =>
      input(`photo-${index}.png`, pngBytes({ seed: index })),
    );
    const openPdf = pdfOpener(Array.from({ length: 10 }, () => []));
    const { images } = await read(
      [...photos, input("deck.pdf", text.encode("%PDF-1.7"))],
      { pdf: "page-captures" },
      { openPdf },
    );
    expect(images).toHaveLength(100);
    expect(images[95].notes).toEqual([
      "A capture of the whole page.",
      "deck.pdf: stopped at page 6 because the limit of 100 images at a time was reached.",
    ]);
  });

  it("stops at 100 MB of images", async () => {
    const limit = IMAGE_LIMITS.maxImageBytes;
    const inputs = Array.from({ length: 5 }, (_, index) =>
      input(`big-${index}.png`, pngBytes({ seed: index, byteLength: limit })),
    );
    inputs.push(input("small.png", pngBytes({ seed: 99 })));
    const { images, rejected } = await read(inputs);
    expect(images).toHaveLength(5);
    expect(rejected).toEqual([
      {
        name: "small.png",
        reason: "Not added: the limit of 100 MB of images at a time was reached.",
      },
    ]);
  });

  it("reports progress per file and per PDF page", async () => {
    const progress: Progress[] = [];
    await read(
      [input("a.png", pngBytes()), input("deck.pdf", text.encode("%PDF-1.7"))],
      { pdf: "page-captures", onProgress: (event) => progress.push(event) },
      { openPdf: pdfOpener([[], []]) },
    );
    expect(progress).toEqual([
      { label: "Reading a.png", completed: 0, total: 2 },
      { label: "Reading deck.pdf", completed: 1, total: 2 },
      { label: "Reading deck.pdf, page 1 of 2", completed: 1, total: 2 },
      { label: "Reading deck.pdf, page 2 of 2", completed: 1, total: 2 },
      { label: "Done", completed: 2, total: 2 },
    ]);
  });

  it("stops when cancelled instead of rejecting files", async () => {
    const controller = new AbortController();
    const reading = read([input("a.png", pngBytes({ seed: 1 })), input("b.png", pngBytes())], {
      signal: controller.signal,
      onProgress: ({ label }) => {
        if (label === "Reading b.png") controller.abort();
      },
    });
    await expect(reading).rejects.toMatchObject({ name: "AbortError" });
  });

  it("stops between the files of a ZIP when cancelled", async () => {
    const controller = new AbortController();
    const zip = await zipBytes([
      ["a.png", pngBytes({ seed: 1 })],
      ["b.png", pngBytes({ seed: 2 })],
    ]);
    const decode = vi.fn(async (image: Blob) => {
      controller.abort();
      return fakeDecoder(image);
    });
    const reading = read([input("album.zip", zip)], { signal: controller.signal }, { decode });
    await expect(reading).rejects.toMatchObject({ name: "AbortError" });
    expect(decode).toHaveBeenCalledTimes(1);
  });
});

describe("memory with large inputs", () => {
  it("reads a ZIP from the file in pieces instead of loading it whole", async () => {
    // Catches the container's bytes, a Blob copy, and every unpacked file all held at once.
    // Random bytes don't compress, so the ZIP is larger than zip.js reads in one go.
    const noise = crypto.getRandomValues(new Uint8Array(60_000));
    const picture = new Uint8Array([
      ...pngBytes(),
      ...noise,
      ...noise,
      ...noise,
      ...noise,
      ...noise,
    ]);
    const zip = new File([await zipBytes([["a.png", picture]])], "album.zip");
    expect(zip.size).toBeGreaterThan(250_000);
    const whole = vi.spyOn(zip, "arrayBuffer");
    const { images } = await read([{ name: "album.zip", file: zip }]);
    expect(images).toHaveLength(1);
    expect(whole).not.toHaveBeenCalled();
  });

  it("checks each unpacked picture before unpacking the next", async () => {
    const events: string[] = [];
    const zip = await zipBytes([
      ["a.png", pngBytes({ seed: 1 })],
      ["b.png", pngBytes({ seed: 2 })],
    ]);
    const openZip: ImageReaderAdapters["openZip"] = async (source) => {
      const real = await openZipArchive(source);
      return {
        async *entries(signal) {
          for await (const entry of real.entries(signal)) {
            yield {
              ...entry,
              read: (writable, abort) => {
                events.push(`unpack ${entry.path}`);
                return entry.read(writable, abort);
              },
            };
          }
        },
        close: () => real.close(),
      };
    };
    const decode = vi.fn(async (image: Blob) => {
      events.push("decode");
      return fakeDecoder(image);
    });
    await read([input("album.zip", zip)], {}, { openZip, decode });
    expect(events).toEqual(["unpack a.png", "decode", "unpack b.png", "decode"]);
  });
});

describe("folderInputs", () => {
  it("sorts by path and puts paths in one form", () => {
    const blob = new Blob([]);
    const names = folderInputs([
      { file: blob, path: "Album/z.png" },
      { file: blob, path: "./Album/a/b.png" },
      { file: blob, path: "Album\\c.png" },
      { file: blob, path: "/Album/B.png" },
    ]).map(({ name }) => name);
    expect(names).toEqual(["Album/B.png", "Album/a/b.png", "Album/c.png", "Album/z.png"]);
  });

  it("skips system files silently and names inner files by their folder path", async () => {
    const docx = await docxBytes({ media: [["image1.png", pngBytes({ seed: 4 })]] });
    const files = [
      { file: new File([pngBytes({ seed: 1 })], "z.png"), path: "Album/z.png" },
      { file: new File([text.encode("finder")], ".DS_Store"), path: "Album/.DS_Store" },
      { file: new File([docx], "report.docx"), path: "Album/docs/report.docx" },
    ];
    const { images, rejected } = await readImages(
      folderInputs(files),
      { pdf: "embedded-images" },
      adapters(),
    );
    expect(rejected).toEqual([]);
    expect(images).toEqual([
      expect.objectContaining({
        name: "image1.png",
        from: { container: "Album/docs/report.docx" },
      }),
      expect.objectContaining({ name: "Album/z.png", from: null }),
    ]);
  });
});
