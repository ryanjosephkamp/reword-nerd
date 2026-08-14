import { Blob as NativeBlob } from "node:buffer";

import {
  extractPdfImages,
  type ImagePdfAdapter,
  type ImagePdfDocument,
  type ImagePdfPage,
  type ImagePdfRaster,
} from "../../src/image/pdfIntake";
import type { ImageDecodeAdapter } from "../../src/image/imageValidation";
import type { ImageIntakeFailure } from "../../src/image/intakeContracts";

const PNG_A = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
), (character) => character.charCodeAt(0));
const PNG_B = Uint8Array.from(PNG_A);
PNG_B[PNG_B.length - 5] ^= 1;

function pdfBlob(): Blob {
  return new NativeBlob([new TextEncoder().encode("%PDF-1.7\nfixture")], { type: "application/pdf" }) as Blob;
}

function issueCode(error: unknown): string | undefined {
  return (error as ImageIntakeFailure | undefined)?.issue?.code;
}

const decoder: ImageDecodeAdapter = {
  decode: async () => ({ width: 1, height: 1, close: () => undefined }),
};

function raster(bytes = PNG_A, events: string[] = [], label = "raster"): ImagePdfRaster {
  return {
    width: 1,
    height: 1,
    readPng: async () => { events.push(`read:${label}`); return bytes; },
    close: () => { events.push(`close:${label}`); },
  };
}

function page(
  pageNumber: number,
  rasters: readonly ImagePdfRaster[],
  events: string[],
): ImagePdfPage {
  return {
    enumerateEmbeddedRasters: async () => {
      events.push(`enumerate:${pageNumber}`);
      return rasters;
    },
    renderCapturePng: async (scale) => {
      events.push(`capture:${pageNumber}:${scale}`);
      return { bytes: PNG_B, width: 1, height: 1 };
    },
    cleanup: () => { events.push(`cleanup:${pageNumber}`); },
  };
}

function adapter(document: ImagePdfDocument, events: string[] = []): ImagePdfAdapter {
  return {
    load: (_source, options) => {
      events.push(`load:maxImageSize=${options.maxImageSize}`);
      return {
        promise: Promise.resolve(document),
        destroy: async () => { events.push("destroy:task"); },
      };
    },
  };
}

function options(pdfAdapter: ImagePdfAdapter) {
  return {
    containerName: "visuals.pdf",
    containerHash: "c".repeat(64),
    adapter: pdfAdapter,
    decoder,
    hash: async (blob: Blob) => `hash-${blob.size}`,
  };
}

describe("Image PDF intake", () => {
  it("accepts a textless PDF, enumerates all embedded rasters before selected captures, and passes maxImageSize", async () => {
    // Catches Text extraction requirements, selected-page filtering of embedded images, or late PDF.js image caps.
    const events: string[] = [];
    const pages = [page(1, [raster(PNG_A, events, "p1")], events), page(2, [raster(PNG_B, events, "p2")], events)];
    const document: ImagePdfDocument = {
      numPages: 2,
      getPage: async (number) => pages[number - 1],
      destroy: async () => { events.push("destroy:document"); },
    };
    const result = await extractPdfImages(pdfBlob(), {
      ...options(adapter(document, events)),
      capturePages: [2],
      captureQuality: "high",
    });
    expect(events.slice(0, 3)).toEqual([
      "load:maxImageSize=40000000",
      "enumerate:1",
      "enumerate:2",
    ]);
    expect(events.indexOf("read:p2")).toBeLessThan(events.indexOf("capture:2:3"));
    expect(result.images.map(({ provenance }) => ({ kind: provenance.intakeKind, page: provenance.pageNumber }))).toEqual([
      { kind: "pdf-extracted", page: 1 },
      { kind: "pdf-extracted", page: 2 },
      { kind: "pdf-extracted", page: 2 },
    ]);
    expect(events).toContain("cleanup:1");
    expect(events).toContain("cleanup:2");
    expect(events.slice(-2)).toEqual(["destroy:document", "destroy:task"]);
  });

  it("uses standard/high capture scales 2/3 and capture selection never limits embedded extraction", async () => {
    // Catches capture controls changing the all-pages embedded-raster default.
    for (const [quality, scale] of [["standard", 2], ["high", 3]] as const) {
      const events: string[] = [];
      const pages = [page(1, [raster(PNG_A, events, "p1")], events), page(2, [raster(PNG_B, events, "p2")], events)];
      const document: ImagePdfDocument = {
        numPages: 2,
        getPage: async (number) => pages[number - 1],
        destroy: async () => undefined,
      };
      await extractPdfImages(pdfBlob(), {
        ...options(adapter(document)),
        capturePages: [1],
        captureQuality: quality,
      });
      expect(events.filter((event) => event.startsWith("read:"))).toEqual(["read:p1", "read:p2"]);
      expect(events).toContain(`capture:1:${scale}`);
      expect(events.some((event) => event.startsWith("capture:2"))).toBe(false);
    }
  });

  it("stages structural enumeration atomically and cleans every acquired resource on parser failure", async () => {
    // Catches page-one candidates publishing before a later page/operator-list structural failure.
    const events: string[] = [];
    const first = page(1, [raster(PNG_A, events, "must-not-read")], events);
    const second = page(2, [], events);
    second.enumerateEmbeddedRasters = async () => { events.push("enumerate:2"); throw new Error("parser details"); };
    const document: ImagePdfDocument = {
      numPages: 2,
      getPage: async (number) => number === 1 ? first : second,
      destroy: async () => { events.push("destroy:document"); },
    };
    await expect(extractPdfImages(pdfBlob(), options(adapter(document, events))))
      .rejects.toSatisfy((error: unknown) => issueCode(error) === "MALFORMED_PDF");
    expect(events).not.toContain("read:must-not-read");
    expect(events).toContain("close:must-not-read");
    expect(events).toContain("cleanup:1");
    expect(events).toContain("cleanup:2");
    expect(events.slice(-2)).toEqual(["destroy:document", "destroy:task"]);
  });

  it("guards raster dimensions before reading/allocating and keeps valid siblings as partial success", async () => {
    // Catches a limit-sized PDF image allocating RGBA/canvas memory before dimension validation.
    const events: string[] = [];
    const oversized = { ...raster(PNG_A, events, "oversized"), width: 16_385 };
    const document: ImagePdfDocument = {
      numPages: 1,
      getPage: async () => page(1, [oversized, raster(PNG_A, events, "safe")], events),
      destroy: async () => undefined,
    };
    const result = await extractPdfImages(pdfBlob(), options(adapter(document)));
    expect(events).not.toContain("read:oversized");
    expect(events).toContain("close:oversized");
    expect(result.images).toHaveLength(1);
    expect(result.issues.map(({ code }) => code)).toEqual(["DIMENSIONS_LIMIT_EXCEEDED"]);
  });

  it.each([
    ["PasswordException", "PDF_PASSWORD_PROTECTED"],
    ["InvalidPDFException", "MALFORMED_PDF"],
    ["FormatError", "MALFORMED_PDF"],
  ] as const)("maps %s to a bounded issue and destroys the loading task", async (name, expected) => {
    // Catches parser details escaping or a rejected loading task surviving intake.
    let destroyed = 0;
    const pdfAdapter: ImagePdfAdapter = {
      load: () => ({
        promise: Promise.reject(Object.assign(new Error("private parser detail"), { name })),
        destroy: async () => { destroyed += 1; },
      }),
    };
    await expect(extractPdfImages(pdfBlob(), options(pdfAdapter))).rejects.toSatisfy(
      (error: unknown) => issueCode(error) === expected && !(error as Error).message.includes("private parser"),
    );
    expect(destroyed).toBe(1);
  });

  it("preserves abort custody while PDF loading is still pending and destroys the loading task", async () => {
    // Catches reset cancellation being mislabeled as a malformed document while the parser promise is detached.
    const controller = new AbortController();
    let destroyed = 0;
    const load = vi.fn(() => ({
      promise: new Promise<ImagePdfDocument>(() => undefined),
      destroy: async () => { destroyed += 1; },
    }));
    const pdfAdapter: ImagePdfAdapter = {
      load,
    };
    const pending = extractPdfImages(pdfBlob(), {
      ...options(pdfAdapter),
      signal: controller.signal,
    });
    void pending.catch(() => undefined);
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(destroyed).toBe(1);
  });

  it("rejects page cap and no-supported-image documents with complete cleanup", async () => {
    // Catches unbounded page enumeration or a visual-empty PDF being reported as successful.
    for (const document of [
      { numPages: 501, getPage: vi.fn(), destroy: vi.fn(async () => undefined) },
      { numPages: 1, getPage: async () => page(1, [], []), destroy: vi.fn(async () => undefined) },
    ]) {
      const expected = document.numPages === 501 ? "PDF_PAGE_LIMIT_EXCEEDED" : "PDF_NO_SUPPORTED_IMAGES";
      await expect(extractPdfImages(pdfBlob(), options(adapter(document))))
        .rejects.toSatisfy((error: unknown) => issueCode(error) === expected);
      expect(document.destroy).toHaveBeenCalledOnce();
      if (document.numPages === 501) expect(document.getPage).not.toHaveBeenCalled();
    }
  });

  it("aborts reset-overlapped work and still closes pages, document, task, and raster handles", async () => {
    // Catches reset suppressing state publication while leaving PDF-owned resources alive.
    const events: string[] = [];
    const controller = new AbortController();
    const pending = raster(PNG_A, events, "pending");
    pending.readPng = async () => {
      events.push("read:pending");
      controller.abort();
      return PNG_A;
    };
    const document: ImagePdfDocument = {
      numPages: 1,
      getPage: async () => page(1, [pending], events),
      destroy: async () => { events.push("destroy:document"); },
    };
    await expect(extractPdfImages(pdfBlob(), { ...options(adapter(document, events)), signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(events).toContain("close:pending");
    expect(events).toContain("cleanup:1");
    expect(events.slice(-2)).toEqual(["destroy:document", "destroy:task"]);
  });
});
