import { useEffect, useState } from "react";
import { useObjectUrl } from "./useObjectUrl";

const MAX_PAGES = 30;
const SCALE = 1.4;

function PageImage({ blob, pageNumber }: { blob: Blob; pageNumber: number }) {
  const url = useObjectUrl(blob);
  return url ? (
    <img className="pdf-page" src={url} alt={`Page ${pageNumber}`} loading="lazy" />
  ) : null;
}

/** Draws a PDF's pages as images, so the original can be seen without running anything in it. */
export function PdfPages({ file }: { file: Blob }) {
  const [state, setState] = useState<{
    file: Blob;
    pages: Blob[];
    total: number;
    error?: string;
  }>();

  useEffect(() => {
    let current = true;
    (async () => {
      try {
        const { openPdf, renderPdfPage } = await import("../engine/pdf");
        const pdf = await openPdf(new Uint8Array(await file.arrayBuffer()));
        const pages: Blob[] = [];
        const count = Math.min(pdf.numPages, MAX_PAGES);
        for (let page = 1; page <= count && current; page += 1) {
          pages.push(await renderPdfPage(pdf, page, SCALE));
          if (current) setState({ file, pages: [...pages], total: pdf.numPages });
        }
        await pdf.destroy();
      } catch (error) {
        if (current) {
          setState({
            file,
            pages: [],
            total: 0,
            error: error instanceof Error ? error.message : "This PDF couldn't be shown.",
          });
        }
      }
    })();
    return () => {
      current = false;
    };
  }, [file]);

  if (!state || state.file !== file) return <p className="loading">Drawing pages…</p>;
  if (state.error) return <p className="muted pane-pad">{state.error}</p>;
  return (
    <div className="pdf-pages">
      {state.pages.map((page, index) => (
        <PageImage key={index} blob={page} pageNumber={index + 1} />
      ))}
      {state.total > MAX_PAGES && (
        <p className="muted small">
          Showing the first {MAX_PAGES} of {state.total} pages.
        </p>
      )}
    </div>
  );
}
