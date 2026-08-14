import { useEffect, useMemo, useRef, useState } from "react";
import workerSource from "pdfjs-dist/build/pdf.worker.min.mjs?url";

const MAX_CANVAS_PIXELS = 16_000_000;
const CONTINUOUS_PAGE_RADIUS = 2;
const GALLERY_PAGE_LIMIT = 12;

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
  return <div className={`pdf-page${active ? " is-active" : " is-adjacent"}`}>
    <canvas ref={canvasRef} aria-hidden="true" style={{ width: `${Math.max(1, page.width * scale)}px`, height: `${Math.max(1, page.height * scale)}px` }} />
    <details className="pdf-selectable-text">
      <summary>SELECTABLE TEXT · PAGE {pageNumber}</summary>
      <p role="region" aria-label={`Selectable text for PDF page ${pageNumber}`} tabIndex={0}>
        {page.text || `Page ${pageNumber} has no selectable text.`}
      </p>
    </details>
  </div>;
}

function PdfGalleryThumbnail({ page, pageNumber }: { page: PdfPreviewPage; pageNumber: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scale = Math.max(0.08, Math.min(0.3, 180 / Math.max(1, page.width)));
  useEffect(() => {
    const controller = new AbortController();
    if (canvasRef.current) void page.render(canvasRef.current, scale, controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [page, scale]);
  return <canvas
    ref={canvasRef}
    aria-label={`Thumbnail for PDF page ${pageNumber}`}
    style={{ width: `${Math.max(1, page.width * scale)}px`, height: `${Math.max(1, page.height * scale)}px` }}
  />;
}

function centeredPageWindow(activePage: number, pageCount: number, limit: number): number[] {
  const boundedLimit = Math.min(pageCount, limit);
  const start = Math.max(1, Math.min(activePage - Math.floor(boundedLimit / 2), pageCount - boundedLimit + 1));
  return Array.from({ length: boundedLimit }, (_, index) => start + index);
}

function PdfOriginalPreviewSession({ bytes, loader }: { bytes: Uint8Array; loader: PdfPreviewLoader }) {
  const [document, setDocument] = useState<PdfPreviewDocument | null>(null);
  const [pages, setPages] = useState(new Map<number, PdfPreviewPage>());
  const [activePage, setActivePage] = useState(1);
  const [view, setView] = useState<"continuous" | "gallery">("continuous");
  const [zoom, setZoom] = useState<"fit" | number>("fit");
  const [containerWidth, setContainerWidth] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const generation = useRef(0);
  const pagesRef = useRef(new Map<number, PdfPreviewPage>());
  const pageWindowRef = useRef<HTMLDivElement>(null);
  const pageSlotsRef = useRef(new Map<number, HTMLElement>());
  const requestedPageRef = useRef<number | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
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

  const visibleNumbers = useMemo(() => {
    if (!document) return [];
    if (view === "gallery") return centeredPageWindow(activePage, document.numPages, GALLERY_PAGE_LIMIT);
    const start = Math.max(1, activePage - CONTINUOUS_PAGE_RADIUS);
    const end = Math.min(document.numPages, activePage + CONTINUOUS_PAGE_RADIUS);
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }, [activePage, document, view]);
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
  useEffect(() => {
    const container = pageWindowRef.current;
    if (!container) return;
    const measure = (width: number) => setContainerWidth(Math.max(0, width));
    measure(container.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => measure(entries[0]?.contentRect.width ?? container.clientWidth));
    observer.observe(container);
    return () => observer.disconnect();
  }, [document, view]);
  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
  }, []);
  useEffect(() => {
    const requestedPage = requestedPageRef.current;
    if (view !== "continuous" || requestedPage === null || requestedPage !== activePage) return;
    const slot = pageSlotsRef.current.get(requestedPage);
    if (!slot) return;
    requestedPageRef.current = null;
    slot.scrollIntoView?.({ block: "start" });
    slot.focus({ preventScroll: true });
  }, [activePage, view]);
  if (loadFailed) return <p className="preview-error">This PDF could not be previewed safely.</p>;
  if (!document) return <p>Loading PDF locally…</p>;
  const active = pages.get(activePage);
  const fitScale = active && containerWidth > 0 ? Math.max(0.1, Math.min(2, containerWidth / active.width)) : 0.9;
  const scale = zoom === "fit" ? fitScale : zoom;
  const openContinuousPage = (pageNumber: number) => {
    const bounded = Math.max(1, Math.min(document.numPages, pageNumber));
    requestedPageRef.current = bounded;
    setActivePage(bounded);
    setView("continuous");
  };
  const updateActivePageFromScroll = () => {
    if (view !== "continuous" || scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const container = pageWindowRef.current;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const center = containerRect.top + container.clientHeight / 2;
      let nearestPage = activePage;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const [pageNumber, slot] of pageSlotsRef.current) {
        const rect = slot.getBoundingClientRect();
        const distance = Math.abs(rect.top + rect.height / 2 - center);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestPage = pageNumber;
        }
      }
      if (nearestPage !== activePage) setActivePage(nearestPage);
    });
  };
  return <div className="pdf-original-preview">
    <div className="pdf-preview-controls">
      <div className="pdf-view-switch" role="group" aria-label="PDF page view">
        <button type="button" aria-pressed={view === "continuous"} onClick={() => openContinuousPage(activePage)}>CONTINUOUS</button>
        <button type="button" aria-pressed={view === "gallery"} onClick={() => setView("gallery")}>GALLERY</button>
      </div>
      <button type="button" disabled={activePage <= 1} onClick={() => openContinuousPage(activePage - 1)}>PREVIOUS PAGE</button>
      <span aria-live="polite">PAGE {activePage} / {document.numPages}</span>
      <button type="button" disabled={activePage >= document.numPages} onClick={() => openContinuousPage(activePage + 1)}>NEXT PAGE</button>
      <button type="button" aria-pressed={zoom === "fit"} onClick={() => setZoom("fit")}>FIT WIDTH</button>
      <button type="button" onClick={() => setZoom(Math.min(2, scale + 0.1))}>ZOOM IN</button>
      <button type="button" onClick={() => setZoom(Math.max(0.1, scale - 0.1))}>ZOOM OUT</button>
      <span>ZOOM {Math.round(scale * 100)}%</span>
    </div>
    {view === "continuous" ? <div className="pdf-page-window pdf-continuous-list" ref={pageWindowRef} onScroll={updateActivePageFromScroll}>
      {Array.from({ length: document.numPages }, (_, index) => index + 1).map((number) => {
        const page = pages.get(number);
        const pageScale = page && zoom === "fit" && containerWidth > 0
          ? Math.max(0.1, Math.min(2, containerWidth / page.width))
          : scale;
        const placeholderHeight = page ? Math.max(240, page.height * pageScale + 54) : Math.max(480, (active?.height ?? 800) * scale + 54);
        return <section
          key={number}
          ref={(node) => { if (node) pageSlotsRef.current.set(number, node); else pageSlotsRef.current.delete(number); }}
          className={`pdf-page-slot${number === activePage ? " is-active" : ""}`}
          role="region"
          aria-label={`PDF page slot ${number}`}
          data-pdf-page={number}
          tabIndex={-1}
          style={{ minHeight: `${placeholderHeight}px` }}
        >
          {page
            ? <PdfPageCanvas page={page} pageNumber={number} scale={pageScale} active={number === activePage} />
            : <div className="pdf-page-placeholder" aria-hidden="true"><span>PAGE {number}</span></div>}
        </section>;
      })}
    </div> : <div className="pdf-page-window pdf-page-gallery" ref={pageWindowRef}>
      {Array.from({ length: document.numPages }, (_, index) => index + 1).map((number) => <button
        key={number}
        type="button"
        className="pdf-gallery-page"
        aria-label={`Open PDF page ${number} of ${document.numPages}`}
        aria-current={number === activePage ? "page" : undefined}
        onFocus={() => setActivePage(number)}
        onPointerEnter={() => setActivePage(number)}
        onClick={() => openContinuousPage(number)}
      >
        {pages.get(number)
          ? <PdfGalleryThumbnail page={pages.get(number)!} pageNumber={number} />
          : <span className="pdf-gallery-placeholder" aria-hidden="true">PAGE {number}</span>}
        <strong>PAGE {number}</strong>
      </button>)}
    </div>}
  </div>;
}

export function PdfOriginalPreview({ bytes, identity, loader = browserPdfPreviewLoader }: { bytes: Uint8Array; identity: string; loader?: PdfPreviewLoader }) {
  return <PdfOriginalPreviewSession key={identity} bytes={bytes} loader={loader} />;
}
