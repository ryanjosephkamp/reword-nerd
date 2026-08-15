import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { PdfOriginalPreview, createBrowserPdfPreviewLoader, createDeferredPdfPreviewLoader, type PdfPreviewLoader } from "../../src/app/workbench/components/PdfOriginalPreview";

describe("PDF ORIGINAL preview", () => {
  it("loads PDF.js with active features disabled and disposes loading and document resources", async () => {
    // This catches eval/XFA/network-prefetch being enabled or PDF resources surviving the preview session.
    const loadingDestroy = vi.fn();
    const documentDestroy = vi.fn();
    const getDocument = vi.fn(() => ({
      promise: Promise.resolve({ numPages: 1, getPage: vi.fn(), destroy: documentDestroy }),
      destroy: loadingDestroy,
    }));
    const loader = createBrowserPdfPreviewLoader({ getDocument } as never);
    const loading = loader.load(new Uint8Array([1, 2, 3]));
    await loading.promise;
    expect(getDocument).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.any(Uint8Array), stopAtErrors: true, isEvalSupported: false,
      disableFontFace: true, enableXfa: false, disableAutoFetch: true,
    }));
    await loading.destroy();
    expect(loadingDestroy).toHaveBeenCalledOnce();
  });

  it("destroys a deferred PDF load after unmount and shows a safe load failure", async () => {
    // This catches unmount-before-import leaks and rejected PDF loads hanging forever on Loading.
    let resolveModule!: (value: never) => void;
    const modulePromise = new Promise<never>((resolve) => { resolveModule = resolve; });
    const innerDestroy = vi.fn();
    const deferred = createDeferredPdfPreviewLoader(() => modulePromise);
    const loading = deferred.load(new Uint8Array([1]));
    void loading.promise.catch(() => undefined);
    await loading.destroy();
    resolveModule({ getDocument: () => ({ promise: new Promise(() => undefined), destroy: innerDestroy }) } as never);
    await waitFor(() => expect(innerDestroy).toHaveBeenCalledOnce());

    const rejected: PdfPreviewLoader = { load: () => ({ promise: Promise.reject(new Error("hostile")), destroy: vi.fn() }) };
    render(<PdfOriginalPreview bytes={new Uint8Array([1])} loader={rejected} identity="bad-pdf" />);
    expect(await screen.findByText("This PDF could not be previewed safely.")).toBeInTheDocument();
  });

  it("renders a bounded continuous five-page window while exposing every page as a scroll slot", async () => {
    // This catches eager whole-document rendering or a return to click-only pagination.
    const cleanup = vi.fn();
    const destroy = vi.fn();
    const getPage = vi.fn(async (pageNumber: number) => ({
      width: 600,
      height: 800,
      text: `Selectable page ${pageNumber}`,
      render: async () => undefined,
      cleanup,
    }));
    const loader: PdfPreviewLoader = { load: () => ({ promise: Promise.resolve({ numPages: 7, getPage, destroy }), destroy: vi.fn() }) };
    const { unmount } = render(<PdfOriginalPreview bytes={new Uint8Array([1])} loader={loader} identity="pdf:hash" />);
    expect(await screen.findByText("Selectable page 1")).toBeInTheDocument();
    await waitFor(() => expect(getPage.mock.calls.map(([page]) => page)).toEqual([1, 2, 3]));
    expect(screen.getAllByRole("region", { name: /PDF page slot/u })).toHaveLength(7);
    expect(screen.queryByText("Selectable page 4")).not.toBeInTheDocument();
    unmount();
    expect(cleanup).toHaveBeenCalledTimes(3);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("exposes long selectable page text as its own keyboard-readable scroll region", async () => {
    // This catches expanded PDF text escaping its page slot and becoming unreadable over the next canvas.
    const loader: PdfPreviewLoader = { load: () => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          width: 600,
          height: 800,
          text: "Long selectable page text. ".repeat(120),
          render: async () => undefined,
          cleanup: vi.fn(),
        }),
        destroy: vi.fn(),
      }),
      destroy: vi.fn(),
    }) };

    render(<PdfOriginalPreview bytes={new Uint8Array([1])} loader={loader} identity="long-text-pdf" />);

    const textRegion = await screen.findByRole("region", { name: "Selectable text for PDF page 1" });
    expect(textRegion).toHaveAttribute("tabindex", "0");
  });

  it("updates the active page from scrolling without requiring Next Page", async () => {
    const cleanup = vi.fn();
    const getPage = vi.fn(async (pageNumber: number) => ({
      width: 600,
      height: 800,
      text: `Scroll page ${pageNumber}`,
      render: async () => undefined,
      cleanup,
    }));
    const loader: PdfPreviewLoader = { load: () => ({
      promise: Promise.resolve({ numPages: 7, getPage, destroy: vi.fn() }),
      destroy: vi.fn(),
    }) };
    const { container } = render(<PdfOriginalPreview bytes={new Uint8Array([1])} loader={loader} identity="scroll-pdf" />);
    await screen.findByText("Scroll page 1");
    const windowNode = container.querySelector<HTMLElement>(".pdf-page-window")!;
    Object.defineProperty(windowNode, "clientHeight", { configurable: true, value: 600 });
    for (const slot of Array.from(container.querySelectorAll<HTMLElement>("[data-pdf-page]"))) {
      const page = Number(slot.dataset.pdfPage);
      slot.getBoundingClientRect = () => ({
        top: (page - 4) * 900 + 200,
        bottom: (page - 4) * 900 + 1000,
        left: 0,
        right: 600,
        width: 600,
        height: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
    }
    fireEvent.scroll(windowNode);
    await waitFor(() => expect(screen.getByText("PAGE 4 / 7")).toBeInTheDocument());
    await waitFor(() => expect(getPage.mock.calls.map(([page]) => page).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]));
    expect(getPage.mock.calls.length).toBeLessThanOrEqual(6);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("opens a bounded page gallery and returns to the chosen page in continuous view", async () => {
    const getPage = vi.fn(async (pageNumber: number) => ({
      width: 600,
      height: 800,
      text: `Gallery page ${pageNumber}`,
      render: async () => undefined,
      cleanup: vi.fn(),
    }));
    const loader: PdfPreviewLoader = { load: () => ({
      promise: Promise.resolve({ numPages: 14, getPage, destroy: vi.fn() }),
      destroy: vi.fn(),
    }) };
    render(<PdfOriginalPreview bytes={new Uint8Array([1])} loader={loader} identity="gallery-pdf" />);
    await screen.findByText("Gallery page 1");
    fireEvent.click(screen.getByRole("button", { name: "GALLERY" }));
    expect(screen.getAllByRole("button", { name: /Open PDF page \d+ of 14/u })).toHaveLength(14);
    expect(getPage.mock.calls.length).toBeLessThanOrEqual(12);
    fireEvent.click(screen.getByRole("button", { name: "Open PDF page 14 of 14" }));
    await waitFor(() => expect(screen.getByText("PAGE 14 / 14")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "CONTINUOUS" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "PDF page slot 14" })).toHaveFocus();
  });

  it("measures the page container for fit width and exposes zoom as scrollable canvas geometry", async () => {
    // This catches a hard-coded fit scale and max-width CSS making zoom controls visually inert.
    const observers: Array<{ callback: ResizeObserverCallback; disconnect: ReturnType<typeof vi.fn> }> = [];
    class TestResizeObserver {
      readonly disconnect = vi.fn();
      constructor(readonly callback: ResizeObserverCallback) { observers.push(this); }
      observe() { /* driven explicitly below */ }
      unobserve() { /* noop */ }
    }
    const originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;
    const scales: number[] = [];
    const loader: PdfPreviewLoader = { load: () => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({ width: 1_000, height: 1_400, text: "Measured page", render: async (_canvas, scale) => { scales.push(scale); }, cleanup: vi.fn() }),
        destroy: vi.fn(),
      }),
      destroy: vi.fn(),
    }) };
    const { container, unmount } = render(<PdfOriginalPreview bytes={new Uint8Array([1])} loader={loader} identity="measured" />);
    await screen.findByText("Measured page");
    expect(observers).toHaveLength(1);
    act(() => observers[0]!.callback([{ contentRect: { width: 500 } } as ResizeObserverEntry], observers[0] as unknown as ResizeObserver));
    await waitFor(() => expect(scales.at(-1)).toBeCloseTo(0.5));
    expect(container.querySelector("canvas")).toHaveStyle({ width: "500px" });

    fireEvent.click(screen.getByRole("button", { name: "ZOOM IN" }));
    await waitFor(() => expect(scales.at(-1)).toBeCloseTo(0.6));
    expect(container.querySelector("canvas")).toHaveStyle({ width: "600px" });
    expect(screen.getByText("ZOOM 60%")).toBeInTheDocument();
    unmount();
    globalThis.ResizeObserver = originalResizeObserver;
  });
});
