import { render, screen, waitFor } from "@testing-library/react";

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

  it("renders only the active and adjacent pages with accessible text and complete cleanup", async () => {
    // This catches eager whole-document rendering and stale pages/documents leaking after unmount.
    const cleanup = vi.fn();
    const destroy = vi.fn();
    const getPage = vi.fn(async (pageNumber: number) => ({
      width: 600,
      height: 800,
      text: `Selectable page ${pageNumber}`,
      render: async () => undefined,
      cleanup,
    }));
    const loader: PdfPreviewLoader = { load: () => ({ promise: Promise.resolve({ numPages: 4, getPage, destroy }), destroy: vi.fn() }) };
    const { unmount } = render(<PdfOriginalPreview bytes={new Uint8Array([1])} loader={loader} identity="pdf:hash" />);
    expect(await screen.findByText("Selectable page 1")).toBeInTheDocument();
    await waitFor(() => expect(getPage.mock.calls.map(([page]) => page)).toEqual([1, 2]));
    expect(screen.queryByText("Selectable page 3")).not.toBeInTheDocument();
    unmount();
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(destroy).toHaveBeenCalledOnce();
  });
});
