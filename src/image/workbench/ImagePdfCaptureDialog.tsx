import { useState, type RefObject } from "react";
import { ModalShell } from "../../app/workbench/components/ModalShell";
import type { ImagePdfCaptureChoice } from "../intake";
import type { ImagePdfCaptureRequestView } from "./contracts";
import { parseImagePdfPages } from "./pdfPages";

export function ImagePdfCaptureDialog({
  open,
  request,
  returnFocusRef,
  onChoose,
}: {
  open: boolean;
  request: ImagePdfCaptureRequestView | null;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onChoose(choice: ImagePdfCaptureChoice): void;
}) {
  const [mode, setMode] = useState<ImagePdfCaptureChoice["mode"]>("embedded-only");
  const [pages, setPages] = useState("1");
  const [quality, setQuality] = useState<"standard" | "high">("standard");
  const [error, setError] = useState("");
  if (!request) return null;

  const choose = (choice: ImagePdfCaptureChoice) => {
    onChoose(choice);
    returnFocusRef?.current?.focus();
    queueMicrotask(() => returnFocusRef?.current?.focus());
  };

  const submit = () => {
    if (mode === "embedded-only") {
      choose({ mode: "embedded-only" });
      return;
    }
    const parsed = parseImagePdfPages(pages, request.pageCount);
    if (!parsed) {
      setError(`Enter pages from 1 to ${request.pageCount} as comma-separated numbers or ranges.`);
      return;
    }
    choose({ mode: "embedded-and-pages", pages: parsed, quality });
  };

  return <ModalShell
    open={open}
    title="Capture PDF pages"
    closeLabel="Use embedded PDF images only"
    onDismiss={() => onChoose({ mode: "embedded-only" })}
    returnFocusRef={returnFocusRef}
    className="image-pdf-capture-dialog"
  >
    <p><strong>{request.inputName}</strong>{request.path ? ` — ${request.path}` : ""}</p>
    <p>{request.pageCount} {request.pageCount === 1 ? "page" : "pages"}</p>
    <fieldset>
      <legend>PDF visuals</legend>
      <label><input type="radio" name="image-pdf-mode" checked={mode === "embedded-only"} onChange={() => { setMode("embedded-only"); setError(""); }} /> EMBEDDED IMAGES ONLY</label>
      <label><input type="radio" name="image-pdf-mode" checked={mode === "embedded-and-pages"} onChange={() => { setMode("embedded-and-pages"); setError(""); }} /> EMBEDDED + SELECTED PAGES</label>
    </fieldset>
    {mode === "embedded-and-pages" ? <>
      <label>PDF pages<input aria-label="PDF pages" value={pages} onChange={(event) => { setPages(event.target.value); setError(""); }} /></label>
      <fieldset>
        <legend>Capture quality</legend>
        <label><input type="radio" name="image-pdf-quality" checked={quality === "standard"} onChange={() => setQuality("standard")} /> STANDARD</label>
        <label><input type="radio" name="image-pdf-quality" checked={quality === "high"} onChange={() => setQuality("high")} /> HIGH</label>
      </fieldset>
    </> : null}
    {error ? <p role="alert" className="image-error">{error}</p> : null}
    <div className="dialog-actions"><button type="button" onClick={submit}>USE PDF CHOICE</button></div>
  </ModalShell>;
}
