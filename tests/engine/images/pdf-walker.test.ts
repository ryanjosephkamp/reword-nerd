import { PdfPasswordError } from "../../../src/engine/pdf";
import { IMAGE_LIMITS } from "../../../src/engine/images/limits";
import {
  PAINT_OPS,
  captureScale,
  listPaintedImages,
  readPdfPictures,
  toRgba,
  type PdfFile,
  type PdfImageData,
  type PdfObjectStore,
  type PdfPage,
  type PdfPicture,
  type ReadPdfOptions,
} from "../../../src/engine/images/pdfImages";

const { paintImageXObject, paintInlineImageXObject, paintImageXObjectRepeat } = PAINT_OPS;
const PAINT_IMAGE_MASK = 83;
const LETTER: [number, number] = [612, 792];

function rgb(width: number, height: number, fill = 1): PdfImageData {
  return { width, height, kind: 2, data: new Uint8Array(width * height * 3).fill(fill) };
}

/** Resolves ids from `values`; ids in `never` stay pending forever, like a lost object. */
function store(values: Record<string, unknown> = {}, never: string[] = []) {
  const requested: string[] = [];
  const objects: PdfObjectStore = {
    get(id, callback) {
      requested.push(id);
      if (never.includes(id)) return null;
      // pdf.js delivers objects after the operator list, so resolve on a later tick.
      setTimeout(() => callback(values[id] ?? null), 0);
      return null;
    },
  };
  return Object.assign(objects, { requested });
}

interface PageSpec {
  ops?: [number, unknown[]][];
  objs?: PdfObjectStore;
  size?: [number, number];
}

function page({ ops = [], objs = store(), size = LETTER }: PageSpec, common: PdfObjectStore) {
  const result: PdfPage & { cleanups: number } = {
    cleanups: 0,
    getOperatorList: async () => ({
      fnArray: ops.map(([operation]) => operation),
      argsArray: ops.map(([, args]) => args),
    }),
    objs,
    commonObjs: common,
    getViewport: ({ scale }) => ({ width: size[0] * scale, height: size[1] * scale }),
    cleanup() {
      result.cleanups += 1;
    },
  };
  return result;
}

function pdf(specs: PageSpec[], { common = store(), numPages = specs.length } = {}) {
  const pages = specs.map((spec) => page(spec, common));
  const file: PdfFile & { destroyed: boolean; renders: [number, number][] } = {
    numPages,
    destroyed: false,
    renders: [],
    getPage: async (pageNumber) => pages[(pageNumber - 1) % pages.length],
    renderPage: async (pageNumber, scale) => {
      file.renders.push([pageNumber, scale]);
      return new Blob([`page ${pageNumber}`], { type: "image/png" });
    },
    destroy: async () => {
      file.destroyed = true;
    },
  };
  return { file, pages };
}

const encode = vi.fn(async (image: PdfImageData) => {
  const pixels = image.data ? Array.from(image.data.subarray(0, 8)).join(",") : "bitmap";
  return new Blob([`${image.width}x${image.height}:${pixels}`], { type: "image/png" });
});

beforeEach(() => {
  encode.mockClear();
});

async function readAll(file: PdfFile, overrides: Partial<ReadPdfOptions> = {}) {
  const pictures: PdfPicture[] = [];
  const summary = await readPdfPictures(new Uint8Array(1), {
    mode: "embedded-images",
    open: async () => file,
    encode,
    onPicture: async (picture) => {
      pictures.push(picture);
      return true;
    },
    ...overrides,
  });
  return { pictures, summary };
}

describe("listPaintedImages", () => {
  it("finds image paints in drawing order and reads each from the right store", async () => {
    const inline = rgb(40, 40);
    const objs = store({ img_p0_1: rgb(100, 50) });
    const common = store({ g_d0_img_p1_1: rgb(64, 64) });
    const painted = await listPaintedImages(
      page(
        {
          objs,
          ops: [
            [paintImageXObject, ["img_p0_1", 100, 50]],
            [PAINT_IMAGE_MASK, [{ data: null }]],
            [paintInlineImageXObject, [inline]],
            [paintImageXObjectRepeat, ["g_d0_img_p1_1", 1, 1, [0, 0]]],
            [1, ["unrelated"]],
          ],
        },
        common,
      ),
    );
    expect(painted.map(({ id }) => id)).toEqual(["img_p0_1", null, "g_d0_img_p1_1"]);
    const loaded = await Promise.all(painted.map((item) => item.load()));
    expect(loaded.map((image) => image?.width)).toEqual([100, 40, 64]);
    expect(objs.requested).toEqual(["img_p0_1"]);
    expect(common.requested).toEqual(["g_d0_img_p1_1"]);
  });

  it("gives null for a failed decode, bad data, or an object that never arrives", async () => {
    const objs = store({ broken: { width: 10 }, failed: null }, ["lost"]);
    const painted = await listPaintedImages(
      page(
        {
          objs,
          ops: [
            [paintImageXObject, ["failed"]],
            [paintImageXObject, ["broken"]],
            [paintImageXObject, ["lost"]],
          ],
        },
        store(),
      ),
      20,
    );
    expect(await Promise.all(painted.map((item) => item.load()))).toEqual([null, null, null]);
  });

  it("stops waiting when cancelled", async () => {
    const controller = new AbortController();
    const painted = await listPaintedImages(
      page({ objs: store({}, ["slow"]), ops: [[paintImageXObject, ["slow"]]] }, store()),
    );
    const loading = painted[0].load(controller.signal);
    controller.abort();
    await expect(loading).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("toRgba", () => {
  it("expands RGB and copies RGBA", () => {
    const fromRgb = toRgba({ width: 2, height: 1, kind: 2, data: Uint8Array.of(1, 2, 3, 4, 5, 6) });
    expect(Array.from(fromRgb)).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);
    const rgba = Uint8ClampedArray.of(9, 8, 7, 6);
    expect(Array.from(toRgba({ width: 1, height: 1, kind: 3, data: rgba }))).toEqual([9, 8, 7, 6]);
  });

  it("unpacks one-bit rows that start on a new byte, with set bits white", () => {
    // 10 pixels wide: two bytes per row, the last six bits of each row are padding.
    const data = Uint8Array.of(0b10000000, 0b01000000, 0b00000000, 0b11000000);
    const pixels = toRgba({ width: 10, height: 2, kind: 1, data });
    const gray = (x: number, y: number) => pixels[(y * 10 + x) * 4];
    expect([gray(0, 0), gray(1, 0), gray(9, 0)]).toEqual([255, 0, 255]);
    expect([gray(0, 1), gray(8, 1), gray(9, 1)]).toEqual([0, 255, 255]);
    expect(pixels[3]).toBe(255);
  });

  it("infers the layout when pdf.js gives none, and refuses unknown ones", () => {
    expect(toRgba({ width: 1, height: 1, data: Uint8Array.of(1, 2, 3) })[3]).toBe(255);
    expect(() => toRgba({ width: 2, height: 2, data: Uint8Array.of(1) })).toThrow();
    expect(() => toRgba({ width: 1, height: 1, bitmap: {} as ImageBitmap })).toThrow();
  });
});

describe("captureScale", () => {
  it("captures a letter page at 150 dpi", () => {
    expect(captureScale(...LETTER)).toBeCloseTo(150 / 72);
  });

  it("scales a huge page down so the rounded size stays within the limits", () => {
    const size = (width: number, height: number) => {
      const scale = captureScale(width, height);
      return [Math.ceil(width * scale), Math.ceil(height * scale)];
    };
    for (const [width, height] of [
      [14_400, 14_400],
      [5_000, 5_001],
    ]) {
      const [wide, high] = size(width, height);
      expect(wide * high).toBeLessThanOrEqual(IMAGE_LIMITS.maxImagePixels);
      expect(wide * high).toBeGreaterThan(IMAGE_LIMITS.maxImagePixels * 0.99);
    }
    // A long, thin banner is limited by its length instead.
    expect(size(30_000, 100)[0]).toBe(IMAGE_LIMITS.maxImageSide);
  });

  it("refuses a page with no size", () => {
    expect(() => captureScale(0, 100)).toThrow();
  });
});

describe("readPdfPictures", () => {
  it("converts embedded pictures and notes what it leaves out", async () => {
    const objs = store({
      big: rgb(200, 100),
      tiny: rgb(31, 400),
      huge: { width: 20_000, height: 100, bitmap: {} },
      failed: null,
    });
    const { file, pages } = pdf([
      {
        objs,
        ops: [
          [paintImageXObject, ["big"]],
          [paintImageXObject, ["tiny"]],
          [paintImageXObject, ["huge"]],
          [paintImageXObject, ["failed"]],
          [paintInlineImageXObject, [rgb(32, 32, 7)]],
        ],
      },
    ]);
    const { pictures, summary } = await readAll(file);
    expect(pictures).toEqual([
      expect.objectContaining({
        name: "page-1-image-1.png",
        pageNumber: 1,
        width: 200,
        capture: false,
      }),
      expect.objectContaining({ name: "page-1-image-2.png", width: 32, height: 32 }),
    ]);
    expect(pictures[0].image).toBeInstanceOf(Blob);
    expect(summary.found).toBe(2);
    expect(summary.leftOut.phrases()).toEqual([
      "left out 1 picture (too small to use, under 32 pixels on a side)",
      "left out 1 picture (too large to use)",
      "left out 1 picture (couldn't be read)",
    ]);
    expect(pages[0].cleanups).toBe(1);
    expect(file.destroyed).toBe(true);
  });

  it("reports a picture shared by several pages on each page but converts it once", async () => {
    const common = store({ g_logo: rgb(80, 80) });
    const ops: [number, unknown[]][] = [[paintImageXObject, ["g_logo"]]];
    const { file } = pdf([{ ops }, { ops }, { ops }], { common });
    const { pictures } = await readAll(file);
    expect(pictures.map(({ pageNumber }) => pageNumber)).toEqual([1, 2, 3]);
    expect(new Set(pictures.map(({ image }) => image)).size).toBe(1);
    expect(encode).toHaveBeenCalledOnce();
    expect(common.requested).toEqual(["g_logo"]);
  });

  it("does not count a repeated tiny picture twice", async () => {
    const common = store({ g_dot: rgb(4, 4) });
    const ops: [number, unknown[]][] = [[paintImageXObject, ["g_dot"]]];
    const { summary } = await readAll(pdf([{ ops }, { ops }], { common }).file);
    expect(summary.leftOut.count).toBe(1);
  });

  it("captures whole pages near 150 dpi", async () => {
    const { file } = pdf([{ size: LETTER }, { size: [200, 100] }]);
    const { pictures } = await readAll(file, { mode: "page-captures" });
    expect(pictures).toEqual([
      expect.objectContaining({ name: "page-1.png", width: 1275, height: 1650, capture: true }),
      expect.objectContaining({ name: "page-2.png", width: 417, height: 209, capture: true }),
    ]);
    expect(file.renders.map(([pageNumber]) => pageNumber)).toEqual([1, 2]);
    expect(file.renders[0][1]).toBeCloseTo(150 / 72);
    expect(encode).not.toHaveBeenCalled();
  });

  it("puts each page's capture before its pictures when taking both", async () => {
    const objs = store({ photo: rgb(50, 50) });
    const { file } = pdf([{ objs, ops: [[paintImageXObject, ["photo"]]] }]);
    const { pictures } = await readAll(file, { mode: "both" });
    expect(pictures.map(({ name }) => name)).toEqual(["page-1.png", "page-1-image-1.png"]);
  });

  it("notes a page that couldn't be drawn and keeps going", async () => {
    const { file } = pdf([{}, {}]);
    file.renderPage = async (pageNumber) => {
      if (pageNumber === 1) throw new Error("render failed");
      return new Blob(["page"]);
    };
    const { pictures, summary } = await readAll(file, { mode: "page-captures" });
    expect(pictures.map(({ name }) => name)).toEqual(["page-2.png"]);
    expect(summary.leftOut.phrases()).toEqual(["left out 1 page capture (couldn't be drawn)"]);
  });

  it("reads at most 500 pages", async () => {
    const onPage = vi.fn();
    const { file } = pdf([{}], { numPages: 612 });
    const { summary } = await readAll(file, { onPage });
    expect(summary.pageCount).toBe(612);
    expect(onPage).toHaveBeenCalledTimes(500);
    expect(onPage).toHaveBeenLastCalledWith(500, 500);
  });

  it("stops when no more pictures are wanted", async () => {
    const { file } = pdf([{}], { numPages: 10 });
    const summary = await readPdfPictures(new Uint8Array(1), {
      mode: "page-captures",
      open: async () => file,
      encode,
      onPicture: async (picture) => picture.pageNumber < 3,
    });
    expect(summary).toMatchObject({ found: 3, stoppedAtPage: 3 });
    expect(file.renders).toHaveLength(3);
    expect(file.destroyed).toBe(true);
  });

  it("explains files that can't be opened", async () => {
    const open = (error: Error) => async () => {
      throw error;
    };
    await expect(readAll(pdf([]).file, { open: open(new PdfPasswordError()) })).rejects.toThrow(
      "This PDF is password-protected. Remove the password and add it again.",
    );
    await expect(readAll(pdf([]).file, { open: open(new Error("Invalid XRef")) })).rejects.toThrow(
      "This PDF couldn't be opened. It may be damaged.",
    );
    await expect(readAll(pdf([], { numPages: 0 }).file)).rejects.toThrow("This PDF has no pages.");
  });

  it("stops when cancelled and still closes the PDF", async () => {
    const controller = new AbortController();
    const { file } = pdf([{}], { numPages: 5 });
    const reading = readAll(file, {
      mode: "page-captures",
      signal: controller.signal,
      onPage: (pageNumber) => {
        if (pageNumber === 2) controller.abort();
      },
    });
    await expect(reading).rejects.toMatchObject({ name: "AbortError" });
    expect(file.destroyed).toBe(true);
  });
});
