import { useEffect, useMemo, useRef, useState } from "react";
import workerSource from "pdfjs-dist/build/pdf.worker.min.mjs?url";

const MAX_CANVAS_PIXELS = 16_000_000;

export interface PdfPreviewPage {
  width: number;
  height: number;
  text: string;
  render(canvas: HTMLCanvasElement, scale: number, signal: AbortSignal): Promise<void>;
  cleanup(): void | Promise<void>;
}

export interface PdfPreviewDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPreviewPage>;
  destroy(): void | Promise<void>;
}

export interface PdfPreviewLoadingTask {
  promise: Promise<PdfPreviewDocument>;
  destroy(): void | Promise<void>;
}

export interface PdfPreviewLoader {
  load(bytes: Uint8Array): PdfPreviewLoadingTask;
}

interface PdfJsPage {
  getViewport(input: { scale: number }): { width: number; height: number };
  getTextContent(): Promise<{ items: Array<{ str?: string; hasEOL?: boolean }> }>;
  render(input: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: unknown }): { promise: Promise<void>; cancel(): void };
  cleanup(): void;
}

interface PdfJsDocument {
  numPages: number;
  getPage(page: number): Promise<PdfJsPage>;
  destroy(): void | Promise<void>;
}

interface PdfJsLoadingTask {
  promise: Promise<PdfJsDocument>;
  destroy(): void | Promise<void>;
}

interface PdfJsModule {
  GlobalWorkerOptions?: { workerSrc: string };
  getDocument(input: Record<string, unknown>): PdfJsLoadingTask;
}

export function createBrowserPdfPreviewLoader(pdfjs: PdfJsModule): PdfPreviewLoader {
  if (pdfjs.GlobalWorkerOptions) pdfjs.GlobalWorkerOptions.workerSrc = workerSource;
  return {
    load(bytes) {
      const loading = pdfjs.getDocument({
        data: bytes.slice(),
        stopAtErrors: true,
        isEvalSupported: false,
        disableFontFace: true,
        enableXfa: false,
        disableAutoFetch: true,
        disableStream: true,
      });
      return {
        promise: loading.promise.then((document) => ({
          numPages: document.numPages,
          getPage: async (pageNumber) => {
            const page = await document.getPage(pageNumber);
            const viewport = page.getViewport({ scale: 1 });
            const textContent = await page.getTextContent();
            const text = textContent.items.map((item) => `${item.str ?? ""}${item.hasEOL ? "\n" : " "}`).join("").trim();
            return {
              width: viewport.width,
              height: viewport.height,
              text,
              render: async (canvas, requestedScale, signal) => {
                const boundedScale = Math.max(0.1, Math.min(requestedScale, Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, viewport.width * viewport.height))));
                const scaled = page.getViewport({ scale: boundedScale });
                canvas.width = Math.max(1, Math.ceil(scaled.width));
                canvas.height = Math.max(1, Math.ceil(scaled.height));
                const context = canvas.getContext("2d", { alpha: false });
                if (!context) throw new Error("Canvas is unavailable.");
                const task = page.render({ canvas, canvasContext: context, viewport: scaled });
                const cancel = () => task.cancel();
                signal.addEventListener("abort", cancel, { once: true });
                try { await task.promise; } finally { signal.removeEventListener("abort", cancel); }
              },
              cleanup: () => page.cleanup(),
            };
          },
          destroy: () => document.destroy(),
        })),
        destroy: () => loading.destroy(),
      };
    },
  };
}

export function createDeferredPdfPreviewLoader(loadModule: () => Promise<PdfJsModule>): PdfPreviewLoader {
  return { load(bytes) {
    let inner: PdfPreviewLoadingTask | undefined;
    let disposed = false;
    const promise = loadModule().then(async (pdfjs) => {
      inner = createBrowserPdfPreviewLoader(pdfjs).load(bytes);
      if (disposed) await inner.destroy();
      return inner.promise;
    });
    return {
      promise,
      destroy: async () => { disposed = true; await inner?.destroy(); },
    };
  } };
}

export const browserPdfPreviewLoader = createDeferredPdfPreviewLoader(
  () => import("pdfjs-dist").then((pdfjs) => pdfjs as unknown as PdfJsModule),
);

function PdfPageCanvas({ page, pageNumber, scale, active }: { page: PdfPreviewPage; pageNumber: number; scale: number; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    if (canvasRef.current) void page.render(canvasRef.current, scale, controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [page, scale]);
  return <section className={`pdf-page${active ? " is-active" : " is-adjacent"}`} aria-label={`PDF page ${pageNumber}`}>
    <canvas ref={canvasRef} aria-hidden="true" />
    <p>{page.text || `Page ${pageNumber} has no selectable text.`}</p>
  </section>;
}

function PdfOriginalPreviewSession({ bytes, loader }: { bytes: Uint8Array; loader: PdfPreviewLoader }) {
  const [document, setDocument] = useState<PdfPreviewDocument | null>(null);
  const [pages, setPages] = useState(new Map<number, PdfPreviewPage>());
  const [activePage, setActivePage] = useState(1);
  const [zoom, setZoom] = useState<"fit" | number>("fit");
  const [loadFailed, setLoadFailed] = useState(false);
  const generation = useRef(0);
  const pagesRef = useRef(new Map<number, PdfPreviewPage>());
  useEffect(() => {
    const current = ++generation.current;
    const loading = loader.load(bytes);
    let loaded: PdfPreviewDocument | undefined;
    const retainedPages = pagesRef.current;
    void loading.promise.then((value) => {
      loaded = value;
      if (current === generation.current) setDocument(value);
      else void value.destroy();
    }).catch(() => { if (current === generation.current) setLoadFailed(true); });
    return () => {
      generation.current += 1;
      for (const page of retainedPages.values()) void page.cleanup();
      retainedPages.clear();
      void loaded?.destroy();
      void loading.destroy();
    };
  }, [bytes, loader]);

  const visibleNumbers = useMemo(() => document
    ? [activePage - 1, activePage, activePage + 1].filter((page) => page >= 1 && page <= document.numPages)
    : [], [activePage, document]);
  useEffect(() => {
    if (!document) return;
    let cancelled = false;
    const keep = new Set(visibleNumbers);
    for (const [number, page] of pagesRef.current) {
      if (!keep.has(number)) { void page.cleanup(); pagesRef.current.delete(number); }
    }
    void Promise.all(visibleNumbers.map(async (number) => {
      if (pagesRef.current.has(number)) return;
      const page = await document.getPage(number);
      if (cancelled || !keep.has(number)) { await page.cleanup(); return; }
      pagesRef.current.set(number, page);
    })).then(() => { if (!cancelled) setPages(new Map(pagesRef.current)); });
    return () => { cancelled = true; };
  }, [document, visibleNumbers]);
  if (loadFailed) return <p className="preview-error">This PDF could not be previewed safely.</p>;
  if (!document) return <p>Loading PDF locally…</p>;
  const scale = zoom === "fit" ? 0.9 : zoom;
  return <div className="pdf-original-preview">
    <div className="pdf-preview-controls">
      <button type="button" disabled={activePage <= 1} onClick={() => setActivePage((page) => Math.max(1, page - 1))}>PREVIOUS PAGE</button>
      <span>PAGE {activePage} / {document.numPages}</span>
      <button type="button" disabled={activePage >= document.numPages} onClick={() => setActivePage((page) => Math.min(document.numPages, page + 1))}>NEXT PAGE</button>
      <button type="button" aria-pressed={zoom === "fit"} onClick={() => setZoom("fit")}>FIT WIDTH</button>
      <button type="button" onClick={() => setZoom((value) => typeof value === "number" ? Math.min(2, value + 0.1) : 1.1)}>ZOOM IN</button>
      <button type="button" onClick={() => setZoom((value) => typeof value === "number" ? Math.max(0.5, value - 0.1) : 0.8)}>ZOOM OUT</button>
    </div>
    <div className="pdf-page-window">{visibleNumbers.map((number) => pages.get(number) ? <PdfPageCanvas key={number} page={pages.get(number)!} pageNumber={number} scale={scale} active={number === activePage} /> : null)}</div>
  </div>;
}

export function PdfOriginalPreview({ bytes, identity, loader = browserPdfPreviewLoader }: { bytes: Uint8Array; identity: string; loader?: PdfPreviewLoader }) {
  return <PdfOriginalPreviewSession key={identity} bytes={bytes} loader={loader} />;
}
