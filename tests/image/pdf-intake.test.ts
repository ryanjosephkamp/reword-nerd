import { Blob as NativeBlob } from "node:buffer";
import { parse } from "acorn";

import {
  extractPdfImages,
  loadBrowserImagePdfAdapter,
  type ImagePdfAdapter,
  type ImagePdfDocument,
  type ImagePdfPage,
  type ImagePdfRaster,
} from "../../src/image/pdfIntake";
import type { ImageDecodeAdapter } from "../../src/image/imageValidation";
import type { ImageIntakeFailure } from "../../src/image/intakeContracts";

const browserPdf = vi.hoisted(() => ({
  GlobalWorkerOptions: { workerSrc: "" },
  AnnotationMode: { DISABLE: 0, ENABLE: 1 },
  PagesMapper: { instance: { getPageId: (pageNumber: number) => pageNumber } },
  OPS: {
    paintImageXObject: 91,
    paintInlineImageXObject: 92,
  },
  version: "5.4.624",
  build: "384c6208b",
  getDocument: vi.fn(),
}));

vi.mock("pdfjs-dist", () => browserPdf);

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

function pdfObjects(initial: ReadonlyArray<readonly [string, unknown]> = []) {
  const values = new Map<string, unknown>(initial);
  return {
    get(id: string, callback?: (value: unknown) => void) {
      if (!values.has(id)) {
        if (callback) return null;
        throw new Error(`missing ${id}`);
      }
      const value = values.get(id);
      callback?.(value);
      return callback ? null : value;
    },
    delete: vi.fn((id: string) => values.delete(id)),
    clear: vi.fn(() => values.clear()),
    resolve(id: string, value: unknown) { values.set(id, value); },
    *[Symbol.iterator]() { yield* values.entries(); },
  };
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
    async *enumerateEmbeddedRasters() {
      events.push(`enumerate:${pageNumber}`);
      for (const raster of rasters) yield raster;
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
  it("uses the guarded exact-version PDF.js stream and releases each owned raster before reading the next chunk", async () => {
    // Catches regression to eager getOperatorList(), an unpatched worker, or read-ahead across decoded raster chunks.
    const image = { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255]) };
    const chunks = [
      { fnArray: [browserPdf.OPS.paintInlineImageXObject], argsArray: [[image]], length: 1, lastChunk: false, separateAnnots: null },
      { fnArray: [browserPdf.OPS.paintInlineImageXObject], argsArray: [[image]], length: 1, lastChunk: true, separateAnnots: null },
    ];
    let chunkIndex = 0;
    const cancel = vi.fn(async () => undefined);
    const read = vi.fn(async () => chunkIndex < chunks.length
      ? { value: chunks[chunkIndex++], done: false as const }
      : { value: undefined, done: true as const });
    const sendWithStream = vi.fn(() => ({ getReader: () => ({ read, cancel, releaseLock: vi.fn() }) }));
    const getOperatorList = vi.fn();
    const cleanup = vi.fn();
    const destroyDocument = vi.fn(async () => undefined);
    const destroyTask = vi.fn(async () => undefined);
    const getRenderingIntent = vi.fn(() => ({
      renderingIntent: 1,
      cacheKey: "display_",
      annotationStorageSerializable: { map: null, transfer: undefined },
      modifiedIds: null,
    }));
    const page = {
      _pageIndex: 0,
      _transport: {
        getRenderingIntent,
        messageHandler: { sendWithStream },
      },
      objs: pdfObjects(),
      commonObjs: pdfObjects(),
      getOperatorList,
      cleanup,
    };
    browserPdf.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => page,
        destroy: destroyDocument,
      }),
      destroy: destroyTask,
      onPassword: undefined,
    });
    let workerBlob: Blob | undefined;
    const createObjectURL = vi.fn((blob: Blob) => {
      workerBlob = blob;
      return "blob:bounded-pdf-worker";
    });
    const NativeUrl = URL;
    class StubUrl extends NativeUrl {}
    Object.defineProperty(StubUrl, "createObjectURL", { value: createObjectURL });
    vi.stubGlobal("URL", StubUrl);
    const context = { drawImage: vi.fn(), putImageData: vi.fn() };
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as never);
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new NativeBlob([PNG_A], { type: "image/png" }) as Blob);
    });
    vi.stubGlobal("ImageData", class { constructor() { /* test carrier */ } });

    try {
      const adapter = await loadBrowserImagePdfAdapter();
      const loadingTask = adapter.load(new TextEncoder().encode("%PDF-1.7\nfixture"), { maxImageSize: 40_000_000 });
      const document = await loadingTask.promise;
      const browserPage = await document.getPage(1);
      const iterator = browserPage.enumerateEmbeddedRasters()[Symbol.asyncIterator]();
      const first = await iterator.next();
      expect(first.done).toBe(false);
      expect(read).toHaveBeenCalledTimes(1);
      first.value?.close();
      const second = await iterator.next();
      expect(second.done).toBe(false);
      expect(read).toHaveBeenCalledTimes(2);
      second.value?.close();
      await expect(iterator.next()).resolves.toMatchObject({ done: true });
      await document.destroy();
      await loadingTask.destroy();

      expect(workerBlob).toBeDefined();
      const patchedWorker = await workerBlob!.text();
      expect(patchedWorker).toContain("static CHUNK_SIZE=1;");
      expect(patchedWorker).toContain("static TIME_SLOT_DURATION_MS=0;");
      expect(patchedWorker).toContain("static CHECK_TIME_EVERY=2;");
      expect(patchedWorker).toContain("Promise.resolve(t).then(function(){return r.ready})");
      expect(patchedWorker).toContain("const pdfGuardedImagePromise=PDFImage.buildImage");
      expect(patchedWorker).toContain("await pdfGuardedImagePromise;if(i)");
      expect(patchedWorker).toContain("PDF sinkless visual unsupported.");
      expect(patchedWorker).toContain("PDF sinkless operator limit.");
      expect(patchedWorker).toContain("PDF decoded visual limit.");
      expect(patchedWorker).toContain("Number.isSafeInteger(d)&&Number.isSafeInteger(f)");
      expect(patchedWorker).toContain("S=!1;if(S){");
      expect(patchedWorker).toContain(
        "async getOperatorList({stream:e,task:t,resources:a,operatorList:r,initialState:i=null,fallbackFontDict:n=null,prevRefs:s=null}){if(e.isAsync)throw new Error(\"PDF async content unsupported.\");if(e.isAsync){const t=await e.asyncGetBytes();",
      );
      expect(patchedWorker).toContain(
        "async getContentStream(){const e=await this.pdfManager.ensure(this,\"content\");if(e instanceof BaseStream&&!e.isImageStream&&e.isAsync)throw new Error(\"PDF async content unsupported.\");",
      );
      expect(patchedWorker).toContain(
        "const r=e[a];if(r instanceof BaseStream&&r.isAsync)throw new Error(\"PDF async content unsupported.\");",
      );
      expect(patchedWorker).toContain(
        "handleTilingType(e,t,a,r,i,n,s,o){throw new Error(\"PDF tiling pattern unsupported.\");const c=new OperatorList",
      );
      expect(patchedWorker).toContain(
        "loadType3Data(e,t,a){throw new Error(\"PDF Type3 font unsupported.\");if(this.#fe)",
      );
      expect(patchedWorker).toContain(
        "async buildFormXObject(e,t,a,r,i,n,s,o){const{dict:c}=t;if(c.has(\"Group\"))throw new Error(\"PDF form group unsupported.\");const l=lookupMatrix",
      );
      expect(patchedWorker).toContain("t.onCancel=()=>{pdfGuardedCancelled=!0;");
      expect(patchedWorker).toContain("pdfGuardedFinish();n&&info(`page=${i+1} - getOperatorList:");
      expect(patchedWorker).toContain("pdfGuardedFinish();r.terminated||t.error(e)");
      expect(patchedWorker).toContain("this._streamSink.desiredSize<=-7");
      expect(patchedWorker).not.toContain("static CHUNK_SIZE=1e3;");
      expect(patchedWorker).not.toContain("static TIME_SLOT_DURATION_MS=20;");
      expect(patchedWorker).not.toContain("static CHECK_TIME_EVERY=100;");
      expect(patchedWorker).not.toContain("Promise.all([t,r.ready])");
      expect(() => parse(patchedWorker, { ecmaVersion: "latest", sourceType: "module" })).not.toThrow();

      const imageSampleGuardStart = patchedWorker.indexOf(
        "function pdfGuardedChargeImageSamples(",
      );
      const pdfImageClassStart = patchedWorker.indexOf("class PDFImage{");
      expect.soft(imageSampleGuardStart).toBeGreaterThan(-1);
      expect.soft(patchedWorker).toContain("pdfGuardedImageSampleAllocatedBytes");
      expect.soft(patchedWorker).toContain(
        "pdfGuardedChargeImageSamples(this.width,this.height,this.imageMask?1:this.numComps,this.bpc)",
      );
      expect.soft(patchedWorker).toContain(
        'if(this.imageMask&&1!==this.bpc)throw new Error("PDF image sample allocation limit.")',
      );
      expect.soft(patchedWorker).toContain(
        "pdfGuardedChargeImageSamples(r,i,1,1);const c=(r+7>>3)*i,l=await e.getImageData(c)",
      );
      if (imageSampleGuardStart >= 0 && pdfImageClassStart > imageSampleGuardStart) {
        const exactSampleGuard = patchedWorker.slice(
          imageSampleGuardStart,
          pdfImageClassStart,
        ).replaceAll("160000000", "16");
        const createSampleHarness = () => new Function(`
            let pdfGuardedImageSampleAllocatedBytes = 0;
            ${exactSampleGuard}
            return {
              reserve: pdfGuardedChargeImageSamples,
              allocated: () => pdfGuardedImageSampleAllocatedBytes,
            };
          `)() as {
          reserve(width: number, height: number, components: number, bits: number): void;
          allocated(): number;
        };
        const sampleHarness = createSampleHarness();
        sampleHarness.reserve(2, 2, 3, 8);
        expect(sampleHarness.allocated()).toBe(12);
        sampleHarness.reserve(2, 2, 1, 8);
        expect(sampleHarness.allocated()).toBe(16);
        expect(() => sampleHarness.reserve(1, 1, 1, 8))
          .toThrow("PDF image sample allocation limit.");
        expect(sampleHarness.allocated()).toBe(16);
        for (const unsafe of [
          [1, 1, 1, 17],
          [1, 1, 5, 8],
          [16_385, 1, 1, 8],
          [Number.MAX_SAFE_INTEGER, 1, 1, 8],
        ] as const) {
          const [width, height, components, bits] = unsafe;
          expect(() => sampleHarness.reserve(width, height, components, bits))
            .toThrow("PDF image sample allocation limit.");
        }
        expect(sampleHarness.allocated()).toBe(16);
        const componentHeavyHarness = createSampleHarness();
        expect(() => componentHeavyHarness.reserve(2, 2, 4, 16))
          .toThrow("PDF image sample allocation limit.");
        expect(componentHeavyHarness.allocated()).toBe(0);

        const colorSpaceIndex = patchedWorker.indexOf(
          "this.numComps=this.colorSpace.numComps",
          pdfImageClassStart,
        );
        const sampleChargeIndex = patchedWorker.indexOf(
          "pdfGuardedChargeImageSamples(this.width",
          pdfImageClassStart,
        );
        const decodeIndex = patchedWorker.indexOf(
          'this.decode=h.getArray("D","Decode")',
          pdfImageClassStart,
        );
        expect(colorSpaceIndex).toBeLessThan(sampleChargeIndex);
        expect(sampleChargeIndex).toBeLessThan(decodeIndex);
      }

      const operatorHandlerStart = patchedWorker.indexOf(
        'u.on("GetOperatorList",function(e,t){',
      );
      const operatorHandlerEnd = patchedWorker.indexOf(
        'u.on("GetTextContent"',
        operatorHandlerStart,
      );
      const immediateCancelInstall = patchedWorker.indexOf(
        "t.onCancel=()=>{pdfGuardedCancelled=!0;",
        operatorHandlerStart,
      );
      const delayedPageLookup = patchedWorker.indexOf(
        "a.getPage(r).then(function(a){",
        operatorHandlerStart,
      );
      expect.soft(immediateCancelInstall).toBeGreaterThan(operatorHandlerStart);
      expect.soft(immediateCancelInstall).toBeLessThan(delayedPageLookup);
      if (
        operatorHandlerStart >= 0
        && operatorHandlerEnd > operatorHandlerStart
        && immediateCancelInstall > operatorHandlerStart
        && immediateCancelInstall < delayedPageLookup
      ) {
        const operatorRegistration = patchedWorker.slice(
          operatorHandlerStart,
          operatorHandlerEnd,
        );
        let resolvePage!: (page: { getOperatorList(): Promise<unknown> }) => void;
        const delayedPage = new Promise<{ getOperatorList(): Promise<unknown> }>((resolve) => {
          resolvePage = resolve;
        });
        const callbacks = new Map<string, (data: Record<string, unknown>, sink: {
          onCancel?: () => Promise<void>;
          close(): void;
          error(reason: unknown): void;
        }) => void>();
        class WorkerTaskHarness {
          terminated = false;
          readonly finished = Promise.resolve();

          terminate() { this.terminated = true; }
        }
        const startWorkerTask = vi.fn();
        const finishWorkerTask = vi.fn();
        const handlerHarness = {
          on(name: string, callback: (data: Record<string, unknown>, sink: {
            onCancel?: () => Promise<void>;
            close(): void;
            error(reason: unknown): void;
          }) => void) { callbacks.set(name, callback); },
        };
        new Function(
          "u",
          "a",
          "WorkerTask",
          "startWorkerTask",
          "finishWorkerTask",
          "s",
          "ce",
          "info",
          `${operatorRegistration};`,
        )(
          handlerHarness,
          { getPage: () => delayedPage },
          WorkerTaskHarness,
          startWorkerTask,
          finishWorkerTask,
          0,
          1,
          () => undefined,
        );
        const getOperatorList = vi.fn(async () => ({ length: 0 }));
        const sink = { close: vi.fn(), error: vi.fn(), onCancel: undefined as undefined | (() => Promise<void>) };
        callbacks.get("GetOperatorList")?.({
          pageId: "page-1",
          pageIndex: 0,
          intent: "display",
          cacheKey: "display_",
          annotationStorage: null,
          modifiedIds: null,
        }, sink);
        expect(sink.onCancel).toEqual(expect.any(Function));
        const cancellation = sink.onCancel?.();
        let cancellationSettled = false;
        void cancellation?.then(() => { cancellationSettled = true; });
        await Promise.resolve();
        expect(cancellationSettled).toBe(false);
        expect(startWorkerTask).not.toHaveBeenCalled();
        resolvePage({ getOperatorList });
        await cancellation;
        expect(cancellationSettled).toBe(true);
        expect(startWorkerTask).not.toHaveBeenCalled();
        expect(finishWorkerTask).not.toHaveBeenCalled();
        expect(getOperatorList).not.toHaveBeenCalled();
        expect(sink.close).not.toHaveBeenCalled();
        expect(sink.error).not.toHaveBeenCalled();
      }

      const decodeClassStart = patchedWorker.indexOf("class DecodeStream extends BaseStream{");
      const ensureStart = patchedWorker.indexOf("ensureBuffer(e){", decodeClassStart);
      const ensureEnd = patchedWorker.indexOf("getByte(){", ensureStart);
      expect(decodeClassStart).toBeGreaterThan(-1);
      expect(ensureStart).toBeGreaterThan(decodeClassStart);
      expect(ensureEnd).toBeGreaterThan(ensureStart);
      const exactEnsureMethod = patchedWorker.slice(ensureStart, ensureEnd);
      const countingEnsureMethod = exactEnsureMethod
        .replaceAll("134217728", "8")
        .replace("new Uint8Array(a)", "pdfGuardedAllocate(a)");
      expect(countingEnsureMethod).not.toBe(exactEnsureMethod);
      const allocationLengths: number[] = [];
      const harness = new Function("allocationLengths", `
        let pdfGuardedDecodeAllocatedBytes = 0;
        const pdfGuardedAllocate = (length) => {
          allocationLengths.push(length);
          return new Uint8Array(length);
        };
        class GuardedDecodeHarness {
          constructor(minBufferLength) {
            this.buffer = new Uint8Array(0);
            this.minBufferLength = minBufferLength;
          }
          ${countingEnsureMethod}
        }
        return {
          create: (minimum) => new GuardedDecodeHarness(minimum),
          allocated: () => pdfGuardedDecodeAllocatedBytes,
        };
      `)(allocationLengths) as {
        create(minimum: number): { buffer: Uint8Array; ensureBuffer(requested: number): Uint8Array };
        allocated(): number;
      };
      const firstDecode = harness.create(2);
      const secondDecode = harness.create(4);
      const firstView = firstDecode.ensureBuffer(1);
      expect(allocationLengths).toEqual([2]);
      expect(harness.allocated()).toBe(2);
      expect(firstDecode.ensureBuffer(1)).toBe(firstView);
      expect(allocationLengths).toEqual([2]);
      secondDecode.ensureBuffer(3);
      expect(allocationLengths).toEqual([2, 4]);
      expect(harness.allocated()).toBe(6);
      for (const unsafeRequest of [-1, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
        expect(() => firstDecode.ensureBuffer(unsafeRequest)).toThrow("PDF decode allocation limit.");
      }
      expect(allocationLengths).toEqual([2, 4]);
      expect(() => firstDecode.ensureBuffer(4)).toThrow("PDF decode allocation limit.");
      expect(() => secondDecode.ensureBuffer(5)).toThrow("PDF decode allocation limit.");
      expect(allocationLengths).toEqual([2, 4]);
      expect(harness.allocated()).toBe(6);
      expect(firstDecode.ensureBuffer(2)).toBe(firstView);

      const jpegStart = patchedWorker.indexOf("class JpegImage{");
      const jpegEnd = patchedWorker.indexOf("class JpegStream extends DecodeStream{", jpegStart);
      expect(jpegStart).toBeGreaterThan(-1);
      expect(jpegEnd).toBeGreaterThan(jpegStart);
      const exactJpegClass = patchedWorker.slice(jpegStart, jpegEnd);
      const preparedJpegFrames: Array<{
        readonly width: number;
        readonly height: number;
        readonly components: number;
      }> = [];
      const JpegHarness = new Function("preparedJpegFrames", `
        class JpegError extends Error {}
        class DNLMarkerError extends Error {}
        class EOIMarkerError extends Error {}
        const warn = () => undefined;
        const MathClamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);
        const Fa = new Uint8Array(64);
        const readUint16 = (bytes, offset) => bytes[offset] << 8 | bytes[offset + 1];
        const readDataBlock = () => { throw new Error("Unexpected JPEG data block."); };
        const findNextFileMarker = () => null;
        const buildHuffmanTable = () => null;
        const decodeScan = () => 0;
        const buildComponentData = () => new Int16Array(0);
        const prepareComponents = (frame) => {
          preparedJpegFrames.push({
            width: frame.samplesPerLine,
            height: frame.scanLines,
            components: frame.components.length,
          });
          frame.mcusPerLine = 1;
          frame.mcusPerColumn = 1;
          for (const component of frame.components) {
            component.blocksPerLine = 1;
            component.blocksPerColumn = 1;
          }
        };
        ${exactJpegClass}
        return JpegImage;
      `)(preparedJpegFrames) as new () => {
        parse(bytes: Uint8Array): void;
        width: number;
        height: number;
        numComponents: number;
      };
      const jpegSof = (
        width: number,
        height: number,
        components: number,
        firstSampling = 0x11,
      ) => {
        const bytes = [
          0xff, 0xd8,
          0xff, 0xc0,
          0x00, 8 + components * 3,
          0x08,
          height >> 8, height & 0xff,
          width >> 8, width & 0xff,
          components,
        ];
        for (let component = 0; component < components; component += 1) {
          bytes.push(component + 1, component === 0 ? firstSampling : 0x11, 0);
        }
        bytes.push(0xff, 0xd9);
        return Uint8Array.from(bytes);
      };
      for (const invalidJpeg of [
        jpegSof(16_385, 1, 3),
        jpegSof(4_000, 4_000, 3),
        jpegSof(1, 1, 5),
      ]) {
        expect(() => new JpegHarness().parse(invalidJpeg)).toThrow("PDF JPEG decoded visual limit.");
      }
      expect(() => new JpegHarness().parse(jpegSof(1, 1, 3, 0x01)))
        .toThrow("PDF JPEG sampling limit.");
      expect(preparedJpegFrames).toEqual([]);
      const ordinaryJpeg = new JpegHarness();
      ordinaryJpeg.parse(jpegSof(1, 1, 3));
      expect(ordinaryJpeg).toMatchObject({ width: 1, height: 1, numComponents: 3 });
      expect(preparedJpegFrames).toEqual([{ width: 1, height: 1, components: 3 }]);

      const predictorStart = patchedWorker.indexOf("class PredictorStream extends DecodeStream{");
      const predictorEnd = patchedWorker.indexOf("class RunLengthStream extends DecodeStream{", predictorStart);
      expect(predictorStart).toBeGreaterThan(-1);
      expect(predictorEnd).toBeGreaterThan(predictorStart);
      const exactPredictorClass = patchedWorker.slice(predictorStart, predictorEnd);
      const predictorHarness = new Function(`
        class DecodeStream {
          constructor() {
            this.buffer = new Uint8Array(0);
            this.bufferLength = 0;
          }
        }
        class Dict {
          constructor(values) { this.values = values; }
          get(primary, fallback) { return this.values[primary] ?? this.values[fallback]; }
        }
        class FormatError extends Error {}
        ${exactPredictorClass}
        return { PredictorStream, Dict };
      `)() as {
        PredictorStream: new (
          stream: { dict: null; getBytes(length: number): Uint8Array },
          length: number,
          params: unknown,
        ) => { pixBytes: number; rowBytes: number };
        Dict: new (values: Record<string, number>) => unknown;
      };
      const predictorSource = { dict: null, getBytes: (length: number) => new Uint8Array(length) };
      for (const values of [
        { Predictor: 12, Colors: 5, BPC: 8, Columns: 1 },
        { Predictor: 12, Colors: 3, BPC: 17, Columns: 1 },
        { Predictor: 12, Colors: 3, BPC: 8, Columns: 16_385 },
        { Predictor: 12, Colors: 3, BPC: 8, Columns: Number.MAX_SAFE_INTEGER },
      ]) {
        expect(() => new predictorHarness.PredictorStream(
          predictorSource,
          0,
          new predictorHarness.Dict(values),
        )).toThrow("PDF Predictor dimensions unsupported.");
      }
      const ordinaryPredictor = new predictorHarness.PredictorStream(
        predictorSource,
        0,
        new predictorHarness.Dict({ Predictor: 12, Colors: 3, BPC: 8, Columns: 4 }),
      );
      expect(ordinaryPredictor).toMatchObject({ pixBytes: 3, rowBytes: 12 });

      const ccittStart = patchedWorker.indexOf("class CCITTFaxStream extends DecodeStream{");
      const ccittEnd = patchedWorker.indexOf("const Ga=", ccittStart);
      expect(ccittStart).toBeGreaterThan(-1);
      expect(ccittEnd).toBeGreaterThan(ccittStart);
      const exactCcittClass = patchedWorker.slice(ccittStart, ccittEnd);
      const decoderDimensions: Array<readonly [number, number]> = [];
      const ccittHarness = new Function("decoderDimensions", `
        class DecodeStream { constructor() { this.bufferLength = 0; } }
        class Dict {
          constructor(values) { this.values = values; }
          get(key) { return this.values[key]; }
          static get empty() { return new Dict({}); }
        }
        class CCITTFaxDecoder {
          constructor(_source, options) {
            decoderDimensions.push([options.Columns || 1728, options.Rows || 0]);
          }
        }
        ${exactCcittClass}
        return { CCITTFaxStream, Dict };
      `)(decoderDimensions) as {
        CCITTFaxStream: new (
          stream: { dict: null; getByte(): number },
          length: number,
          params: unknown,
        ) => unknown;
        Dict: new (values: Record<string, number>) => unknown;
      };
      const ccittSource = { dict: null, getByte: () => -1 };
      for (const values of [
        { Columns: 0, Rows: 1 },
        { Columns: 16_385, Rows: 1 },
        { Columns: 16_384, Rows: 16_384 },
        { Columns: 1, Rows: -1 },
      ]) {
        expect(() => new ccittHarness.CCITTFaxStream(
          ccittSource,
          0,
          new ccittHarness.Dict(values),
        )).toThrow("PDF CCITT dimensions unsupported.");
      }
      expect(decoderDimensions).toEqual([]);
      new ccittHarness.CCITTFaxStream(
        ccittSource,
        0,
        new ccittHarness.Dict({ Columns: 1_728, Rows: 100 }),
      );
      expect(decoderDimensions).toEqual([[1_728, 100]]);

      expect(patchedWorker).toContain(
        "const va=new Uint8Array(0);let pdfGuardedDecodeAllocatedBytes=0,pdfGuardedImageSampleAllocatedBytes=0;class DecodeStream",
      );
      expect(patchedWorker).toContain(
        "if(!Number.isSafeInteger(e)||e<0)throw new Error(\"PDF decode allocation limit.\")",
      );
      expect(patchedWorker).toContain(
        "if(!Number.isSafeInteger(pdfGuardedNextAllocation)||pdfGuardedNextAllocation>134217728)throw new Error(\"PDF decode allocation limit.\")",
      );
      expect(patchedWorker).toContain("pdfGuardedDecodeAllocatedBytes=pdfGuardedNextAllocation");
      expect(patchedWorker).toContain("class FlateStream extends DecodeStream{#X=!1;");
      expect(patchedWorker).toContain("async asyncGetBytes(){return null;this.stream.reset()");
      expect(patchedWorker).toContain("async getTransferableImage(){return null;if(!await JpegStream.canUseImageDecoder)");
      expect(patchedWorker).toContain("PDF JPEG decoded visual limit.");
      expect(patchedWorker).toContain("PDF JPEG sampling limit.");
      expect(patchedWorker).toContain("PDF JPX visual unsupported.");
      expect(patchedWorker).toContain(
        'class JpxStream extends DecodeStream{constructor(e,t,a){throw new Error("PDF JPX visual unsupported.");',
      );
      expect(patchedWorker).toContain("PDF JBIG2 visual unsupported.");
      expect(patchedWorker).toContain(
        'class Jbig2Stream extends DecodeStream{constructor(e,t,a){throw new Error("PDF JBIG2 visual unsupported.");',
      );
      const jbig2StreamStart = patchedWorker.indexOf("class Jbig2Stream extends DecodeStream{");
      const jpxStreamStart = patchedWorker.indexOf("class JpxStream extends DecodeStream{", jbig2StreamStart);
      expect(jbig2StreamStart).toBeGreaterThan(-1);
      expect(jpxStreamStart).toBeGreaterThan(jbig2StreamStart);
      const exactJbig2Stream = patchedWorker.slice(jbig2StreamStart, jpxStreamStart);
      const Jbig2StreamHarness = new Function(`
        class DecodeStream {}
        ${exactJbig2Stream}
        return Jbig2Stream;
      `)() as new (stream: unknown, length: number, params: unknown) => unknown;
      expect(() => new Jbig2StreamHarness(
        { dict: {}, getBytes: () => new Uint8Array(0) },
        1,
        null,
      )).toThrow("PDF JBIG2 visual unsupported.");
      const jpxStreamEnd = patchedWorker.indexOf("class LZWStream extends DecodeStream{", jpxStreamStart);
      expect(jpxStreamEnd).toBeGreaterThan(jpxStreamStart);
      const exactJpxStream = patchedWorker.slice(jpxStreamStart, jpxStreamEnd);
      const JpxStreamHarness = new Function(`
        class DecodeStream {}
        ${exactJpxStream}
        return JpxStream;
      `)() as new (stream: unknown, length: number, params: unknown) => unknown;
      expect(() => new JpxStreamHarness(
        { dict: {}, getBytes: () => new Uint8Array(0) },
        1,
        null,
      )).toThrow("PDF JPX visual unsupported.");
      expect(patchedWorker).toContain("PDF CCITT dimensions unsupported.");
      expect(patchedWorker).toContain("PDF Predictor dimensions unsupported.");
      expect(patchedWorker).toContain("PDF image dimensions unsupported.");
      expect(patchedWorker).toContain("PDF effective image dimensions unsupported.");
    } finally {
      getContext.mockRestore();
      toBlob.mockRestore();
      vi.unstubAllGlobals();
    }

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(browserPdf.GlobalWorkerOptions.workerSrc).toBe("blob:bounded-pdf-worker");
    expect(sendWithStream).toHaveBeenCalledWith(
      "GetOperatorList",
      expect.objectContaining({ pageId: 0, pageIndex: 0 }),
      expect.objectContaining({ highWaterMark: 1 }),
      undefined,
    );
    expect(getOperatorList).not.toHaveBeenCalled();
    expect(getRenderingIntent).toHaveBeenCalledWith("display", browserPdf.AnnotationMode.DISABLE, null, false, true);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("routes document-global image IDs through commonObjs on every page", async () => {
    // Catches a repeated logo promoted to PDF.js GlobalImageCache hanging on a page-local unresolved object.
    const image = { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255]) };
    const commonObjs = pdfObjects([["g_shared", image]]);
    const localStores: ReturnType<typeof pdfObjects>[] = [];
    const pages = [0, 1].map((pageIndex) => {
      const objs = pdfObjects();
      objs.get = vi.fn(() => { throw new Error("page-local lookup must not handle g_ IDs"); });
      localStores.push(objs);
      let readIndex = 0;
      return {
        _pageIndex: pageIndex,
        _transport: {
          getRenderingIntent: () => ({
            renderingIntent: 1,
            cacheKey: "display_",
            annotationStorageSerializable: { map: null, transfer: undefined },
            modifiedIds: null,
          }),
          messageHandler: {
            sendWithStream: () => ({
              getReader: () => ({
                read: async () => readIndex++ === 0
                  ? {
                    value: {
                      fnArray: [browserPdf.OPS.paintImageXObject],
                      argsArray: [["g_shared", 1, 1]],
                      length: 1,
                      lastChunk: true,
                      separateAnnots: null,
                    },
                    done: false as const,
                  }
                  : { value: undefined, done: true as const },
                cancel: vi.fn(async () => undefined),
                releaseLock: vi.fn(),
              }),
            }),
          },
        },
        objs,
        commonObjs,
        cleanup: vi.fn(),
      };
    });
    browserPdf.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 2,
        getPage: async (pageNumber: number) => pages[pageNumber - 1],
        destroy: vi.fn(async () => undefined),
      }),
      destroy: vi.fn(async () => undefined),
      onPassword: undefined,
    });
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
      putImageData: vi.fn(),
    } as never);
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new NativeBlob([PNG_A], { type: "image/png" }) as Blob);
    });
    vi.stubGlobal("ImageData", class { constructor() { /* test carrier */ } });

    try {
      const adapter = await loadBrowserImagePdfAdapter();
      const loadingTask = adapter.load(new TextEncoder().encode("%PDF-1.7\nfixture"), { maxImageSize: 40_000_000 });
      const document = await loadingTask.promise;
      const dimensions: Array<readonly [number, number]> = [];
      for (let pageNumber = 1; pageNumber <= 2; pageNumber += 1) {
        const browserPage = await document.getPage(pageNumber);
        for await (const candidate of browserPage.enumerateEmbeddedRasters()) {
          dimensions.push([candidate.width, candidate.height]);
          await expect(candidate.readPng()).resolves.toEqual(PNG_A);
          candidate.close();
        }
        browserPage.cleanup();
      }
      expect(dimensions).toEqual([[1, 1], [1, 1]]);
    } finally {
      getContext.mockRestore();
      toBlob.mockRestore();
      vi.unstubAllGlobals();
    }

    expect(localStores.every(({ get }) => !vi.mocked(get).mock.calls.length)).toBe(true);
    expect(commonObjs.delete).not.toHaveBeenCalled();
  });

  it("does not publish a capture until the terminal operator chunk is followed by stream closure", async () => {
    // Catches render completion winning a race before the guarded pump validates exact terminal closure.
    let resolveDone!: (result: ReadableStreamReadResult<never>) => void;
    let readIndex = 0;
    const read = vi.fn(async () => {
      if (readIndex++ === 0) {
        return {
          value: { fnArray: [1], argsArray: [[]], length: 1, lastChunk: true, separateAnnots: null },
          done: false as const,
        };
      }
      return new Promise<ReadableStreamReadResult<never>>((resolve) => { resolveDone = resolve; });
    });
    const sendWithStream = vi.fn(() => ({
      getReader: () => ({ read, cancel: vi.fn(async () => undefined), releaseLock: vi.fn() }),
    }));
    const operatorList = { fnArray: [] as number[], argsArray: [] as unknown[][], lastChunk: false, separateAnnots: null };
    const state = { operatorList, renderTasks: new Set<{
      operatorListIdx: number | null;
      running: boolean;
      cancelled: boolean;
      operatorListChanged(): void;
    }>() };
    let resolveRender!: () => void;
    const renderPromise = new Promise<void>((resolve) => { resolveRender = resolve; });
    const renderState = {
      operatorListIdx: 0 as number | null,
      running: false,
      cancelled: false,
      operatorListChanged() {
        this.operatorListIdx = operatorList.argsArray.length;
        if (operatorList.lastChunk) resolveRender();
      },
    };
    const intent = {
      renderingIntent: 1,
      cacheKey: "display_",
      annotationStorageSerializable: { map: null, transfer: undefined },
      modifiedIds: null,
    };
    const renderOptions: Array<Record<string, unknown>> = [];
    const page = {
      _pageIndex: 0,
      _transport: { getRenderingIntent: () => intent, messageHandler: { sendWithStream } },
      _intentStates: new Map([[intent.cacheKey, state]]),
      _pumpOperatorList: vi.fn(),
      _renderPageChunk(chunk: { fnArray: number[]; argsArray: unknown[][]; lastChunk: boolean }) {
        operatorList.fnArray.push(...chunk.fnArray);
        operatorList.argsArray.push(...chunk.argsArray);
        operatorList.lastChunk = chunk.lastChunk;
        for (const task of state.renderTasks) task.operatorListChanged();
      },
      objs: pdfObjects(),
      commonObjs: pdfObjects(),
      getViewport: () => ({ width: 20, height: 10 }),
      render(options: Record<string, unknown>) {
        renderOptions.push(options);
        this._pumpOperatorList(intent);
        state.renderTasks.add(renderState);
        return { promise: renderPromise, cancel: vi.fn() };
      },
      cleanup: vi.fn(),
    };
    browserPdf.getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 1, getPage: async () => page, destroy: vi.fn(async () => undefined) }),
      destroy: vi.fn(async () => undefined),
      onPassword: undefined,
    });
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as never);
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new NativeBlob([PNG_A], { type: "image/png" }) as Blob);
    });

    try {
      const adapter = await loadBrowserImagePdfAdapter();
      const loadingTask = adapter.load(new TextEncoder().encode("%PDF-1.7\nfixture"), { maxImageSize: 40_000_000 });
      const document = await loadingTask.promise;
      const browserPage = await document.getPage(1);
      const capture = browserPage.renderCapturePng(2);
      await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
      let earlyEncodeError: unknown = null;
      try { expect(toBlob).not.toHaveBeenCalled(); } catch (error) { earlyEncodeError = error; }
      resolveDone({ value: undefined, done: true });
      await expect(capture).resolves.toMatchObject({ width: 20, height: 10 });
      expect(renderOptions[0]).toMatchObject({ annotationMode: browserPdf.AnnotationMode.DISABLE });
      if (earlyEncodeError) throw earlyEncodeError;
    } finally {
      getContext.mockRestore();
      toBlob.mockRestore();
    }
  });

  it("fails capture and releases rendering when retained decoded PDF objects exceed the raw-byte cap", async () => {
    // Catches page.objs/commonObjs accumulating many decoded rasters while operator arrays stay deceptively small.
    const oversizedRetainedSet = pdfObjects([
      ["img_1", { width: 10_000, height: 4_000, bitmap: { close: vi.fn() } }],
      ["img_2", { width: 1, height: 1, bitmap: { close: vi.fn() } }],
    ]);
    let readIndex = 0;
    let resolveReaderCancel!: () => void;
    const cancelReader = vi.fn(() => new Promise<void>((resolve) => { resolveReaderCancel = resolve; }));
    const read = vi.fn(async () => readIndex++ === 0
      ? {
        value: { fnArray: [1], argsArray: [[]], length: 1, lastChunk: true, separateAnnots: null },
        done: false as const,
      }
      : { value: undefined, done: true as const });
    const sendWithStream = vi.fn(() => ({
      getReader: () => ({ read, cancel: cancelReader, releaseLock: vi.fn() }),
    }));
    const operatorList = { fnArray: [] as number[], argsArray: [] as unknown[][], lastChunk: false, separateAnnots: null };
    const state = { operatorList, renderTasks: new Set<{
      operatorListIdx: number | null;
      running: boolean;
      cancelled: boolean;
      operatorListChanged(): void;
    }>() };
    let resolveRender!: () => void;
    const renderPromise = new Promise<void>((resolve) => { resolveRender = resolve; });
    const renderState = {
      operatorListIdx: 0 as number | null,
      running: false,
      cancelled: false,
      operatorListChanged() {
        this.operatorListIdx = operatorList.argsArray.length;
        if (operatorList.lastChunk) resolveRender();
      },
    };
    const intent = {
      renderingIntent: 1,
      cacheKey: "display_",
      annotationStorageSerializable: { map: null, transfer: undefined },
      modifiedIds: null,
    };
    const cancelRender = vi.fn();
    const cleanup = vi.fn();
    const page = {
      _pageIndex: 0,
      _transport: { getRenderingIntent: () => intent, messageHandler: { sendWithStream } },
      _intentStates: new Map([[intent.cacheKey, state]]),
      _pumpOperatorList: vi.fn(),
      _renderPageChunk(chunk: { fnArray: number[]; argsArray: unknown[][]; lastChunk: boolean }) {
        operatorList.fnArray.push(...chunk.fnArray);
        operatorList.argsArray.push(...chunk.argsArray);
        operatorList.lastChunk = chunk.lastChunk;
        for (const task of state.renderTasks) task.operatorListChanged();
      },
      objs: oversizedRetainedSet,
      commonObjs: pdfObjects(),
      getViewport: () => ({ width: 20, height: 10 }),
      render() {
        this._pumpOperatorList(intent);
        state.renderTasks.add(renderState);
        return { promise: renderPromise, cancel: cancelRender };
      },
      cleanup,
    };
    browserPdf.getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 1, getPage: async () => page, destroy: vi.fn(async () => undefined) }),
      destroy: vi.fn(async () => undefined),
      onPassword: undefined,
    });
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as never);
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new NativeBlob([PNG_A], { type: "image/png" }) as Blob);
    });

    try {
      const adapter = await loadBrowserImagePdfAdapter();
      const loadingTask = adapter.load(new TextEncoder().encode("%PDF-1.7\nfixture"), { maxImageSize: 40_000_000 });
      const document = await loadingTask.promise;
      const browserPage = await document.getPage(1);
      const capture = browserPage.renderCapturePng(2);
      let settled = false;
      void capture.then(
        () => { settled = true; },
        () => { settled = true; },
      );
      await vi.waitFor(() => expect(cancelReader).toHaveBeenCalledOnce());
      await Promise.resolve();
      expect(settled).toBe(false);
      resolveReaderCancel();
      await expect(capture)
        .rejects.toSatisfy((error: unknown) => issueCode(error) === "SESSION_BYTES_EXCEEDED");
    } finally {
      getContext.mockRestore();
      toBlob.mockRestore();
    }

    expect(toBlob).not.toHaveBeenCalled();
    expect(cancelRender).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalled();
  });

  it("captures a selected page before releasing page-owned embedded rasters", async () => {
    // Catches bitmap.close() invalidating PDF.js page objects before a selected page capture can render them.
    const events: string[] = [];
    let rasterClosed = false;
    const rasterHandle: ImagePdfRaster = {
      width: 1,
      height: 1,
      readPng: async () => PNG_A,
      close: () => { rasterClosed = true; events.push("close:raster"); },
    };
    const document: ImagePdfDocument = {
      numPages: 1,
      getPage: async () => ({
        async *enumerateEmbeddedRasters() {
          events.push("enumerate");
          yield rasterHandle;
        },
        renderCapturePng: async () => {
          events.push("capture");
          if (rasterClosed) throw new Error("page-owned bitmap was closed before render");
          return { bytes: PNG_B, width: 1, height: 1 };
        },
        cleanup: () => events.push("cleanup"),
      }),
      destroy: async () => undefined,
    };

    const result = await extractPdfImages(pdfBlob(), {
      ...options(adapter(document)),
      capturePages: [1],
    });

    expect(result.images).toHaveLength(2);
    expect(result.issues).toEqual([]);
    expect(events.indexOf("capture")).toBeLessThan(events.indexOf("close:raster"));
  });

  it("feeds a browser render one guarded operator chunk at a time and compacts consumed arrays", async () => {
    // Catches page.render() retaining all streamed operator chunks despite the guarded worker contract.
    const chunks = [
      { fnArray: [1], argsArray: [[]], length: 1, lastChunk: false, separateAnnots: null },
      { fnArray: [2], argsArray: [[]], length: 1, lastChunk: true, separateAnnots: null },
    ];
    let chunkIndex = 0;
    const read = vi.fn(async () => chunkIndex < chunks.length
      ? { value: chunks[chunkIndex++], done: false as const }
      : { value: undefined, done: true as const });
    const cancel = vi.fn(async () => undefined);
    const sendWithStream = vi.fn(() => ({ getReader: () => ({ read, cancel, releaseLock: vi.fn() }) }));
    const operatorList = { fnArray: [] as number[], argsArray: [] as unknown[][], lastChunk: false, separateAnnots: null };
    const state = { operatorList, renderTasks: new Set<{
      operatorListIdx: number | null;
      running: boolean;
      cancelled: boolean;
      operatorListChanged(): void;
    }>() };
    let maximumRetainedOperations = 0;
    let resolveRender!: () => void;
    const renderPromise = new Promise<void>((resolve) => { resolveRender = resolve; });
    const renderState = {
      operatorListIdx: null as number | null,
      running: false,
      cancelled: false,
      operatorListChanged() {
        if (this.running) return;
        this.running = true;
        queueMicrotask(() => {
          this.operatorListIdx = operatorList.argsArray.length;
          this.running = false;
          if (operatorList.lastChunk) resolveRender();
        });
      },
    };
    const intent = {
      renderingIntent: 1,
      cacheKey: "display_",
      annotationStorageSerializable: { map: null, transfer: undefined },
      modifiedIds: null,
    };
    const page = {
      _pageIndex: 0,
      _transport: { getRenderingIntent: () => intent, messageHandler: { sendWithStream } },
      _intentStates: new Map([[intent.cacheKey, state]]),
      _pumpOperatorList: vi.fn(),
      _renderPageChunk(chunk: (typeof chunks)[number]) {
        operatorList.fnArray.push(...chunk.fnArray);
        operatorList.argsArray.push(...chunk.argsArray);
        operatorList.lastChunk = chunk.lastChunk;
        maximumRetainedOperations = Math.max(maximumRetainedOperations, operatorList.argsArray.length);
        for (const task of state.renderTasks) task.operatorListChanged();
      },
      objs: pdfObjects(),
      commonObjs: pdfObjects(),
      getViewport: () => ({ width: 20, height: 10 }),
      render() {
        this._pumpOperatorList(intent);
        state.renderTasks.add(renderState);
        renderState.operatorListIdx = 0;
        return { promise: renderPromise, cancel: () => { renderState.cancelled = true; } };
      },
      cleanup: vi.fn(),
    };
    browserPdf.getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 1, getPage: async () => page, destroy: vi.fn(async () => undefined) }),
      destroy: vi.fn(async () => undefined),
      onPassword: undefined,
    });
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as never);
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new NativeBlob([PNG_A], { type: "image/png" }) as Blob);
    });

    try {
      const adapter = await loadBrowserImagePdfAdapter();
      const loadingTask = adapter.load(new TextEncoder().encode("%PDF-1.7\nfixture"), { maxImageSize: 40_000_000 });
      const document = await loadingTask.promise;
      const browserPage = await document.getPage(1);
      await expect(browserPage.renderCapturePng(2)).resolves.toMatchObject({ width: 20, height: 10 });
    } finally {
      getContext.mockRestore();
      toBlob.mockRestore();
    }

    expect(maximumRetainedOperations).toBe(1);
    expect(read).toHaveBeenCalledTimes(3);
    expect(cancel).not.toHaveBeenCalled();
    expect(operatorList.argsArray).toHaveLength(1);
  });

  it("releases each page and raster before acquiring the next page", async () => {
    // Catches a small hostile PDF retaining every decoded page/raster handle until document teardown.
    let activePages = 0;
    let activeRasters = 0;
    let maximumPages = 0;
    let maximumRasters = 0;
    const document: ImagePdfDocument = {
      numPages: 3,
      getPage: async () => {
        activePages += 1;
        maximumPages = Math.max(maximumPages, activePages);
        return {
          async *enumerateEmbeddedRasters() {
            activeRasters += 1;
            maximumRasters = Math.max(maximumRasters, activeRasters);
            yield {
              width: 1,
              height: 1,
              readPng: async () => PNG_A,
              close: () => { activeRasters -= 1; },
            };
          },
          renderCapturePng: async () => ({ bytes: PNG_B, width: 1, height: 1 }),
          cleanup: () => { activePages -= 1; },
        } satisfies ImagePdfPage;
      },
      destroy: async () => undefined,
    };

    const result = await extractPdfImages(pdfBlob(), options(adapter(document)));

    expect(result.images).toHaveLength(3);
    expect(maximumPages).toBe(1);
    expect(maximumRasters).toBe(1);
    expect(activePages).toBe(0);
    expect(activeRasters).toBe(0);
  });

  it("consumes same-page raster handles as a bounded stream", async () => {
    // Catches one operator-heavy page materializing all decoded raster handles before capacity validation.
    let activeRasters = 0;
    let maximumRasters = 0;
    const streamingPage = {
      async *enumerateEmbeddedRasters() {
        for (let index = 0; index < 3; index += 1) {
          activeRasters += 1;
          maximumRasters = Math.max(maximumRasters, activeRasters);
          yield {
            width: 1,
            height: 1,
            readPng: async () => PNG_A,
            close: () => { activeRasters -= 1; },
          } satisfies ImagePdfRaster;
        }
      },
      renderCapturePng: async () => ({ bytes: PNG_B, width: 1, height: 1 }),
      cleanup: () => undefined,
    } satisfies ImagePdfPage;
    const document: ImagePdfDocument = {
      numPages: 1,
      getPage: async () => streamingPage,
      destroy: async () => undefined,
    };

    const result = await extractPdfImages(pdfBlob(), options(adapter(document)));

    expect(result.images).toHaveLength(3);
    expect(maximumRasters).toBe(1);
    expect(activeRasters).toBe(0);
  });

  it("accepts a textless PDF, captures selected pages before releasing rasters, and passes maxImageSize", async () => {
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
    expect(events.slice(0, 2)).toEqual(["load:maxImageSize=40000000", "enumerate:1"]);
    expect(events.indexOf("cleanup:1")).toBeLessThan(events.indexOf("enumerate:2"));
    expect(events.indexOf("capture:2:3")).toBeLessThan(events.indexOf("read:p2"));
    expect(result.images.map(({ provenance }) => ({ kind: provenance.intakeKind, page: provenance.pageNumber }))).toEqual([
      { kind: "pdf-extracted", page: 1 },
      { kind: "pdf-extracted", page: 2 },
      { kind: "pdf-extracted", page: 2 },
    ]);
    for (const image of result.images) {
      expect(image.warnings).toContain(
        "Exact derived PNG bytes are preserved; this is locally rasterized PDF recovery output, not original PDF image-stream bytes.",
      );
      expect(image.warnings).not.toContain(
        "Exact source bytes are preserved and may retain EXIF or location metadata.",
      );
    }
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

  it("returns no partial result and cleans already-processed resources on a later parser failure", async () => {
    // Catches a later operator-list failure leaking earlier page/raster handles or returning a partial result.
    const events: string[] = [];
    const first = page(1, [raster(PNG_A, events, "must-not-read")], events);
    const second = page(2, [], events);
    second.enumerateEmbeddedRasters = async function* () {
      events.push("enumerate:2");
      yield* [] as ImagePdfRaster[];
      throw new Error("parser details");
    };
    const document: ImagePdfDocument = {
      numPages: 2,
      getPage: async (number) => number === 1 ? first : second,
      destroy: async () => { events.push("destroy:document"); },
    };
    await expect(extractPdfImages(pdfBlob(), options(adapter(document, events))))
      .rejects.toSatisfy((error: unknown) => issueCode(error) === "MALFORMED_PDF");
    expect(events).toContain("read:must-not-read");
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
