import { useState } from "react";
import {
  MAX_IMAGE_OCR_TEXT_LENGTH,
  type ImagePortalItem,
} from "../contracts";

export function ImageOcrReview({
  item,
  onRun,
  onReview,
}: {
  item: Readonly<ImagePortalItem>;
  onRun(): void;
  onReview(status: "accepted" | "rejected", reviewedText: string | null): void;
}) {
  const [draft, setDraft] = useState(item.ocr.detectedText ?? "");
  const codePoints = Array.from(draft).length;
  const overLimit = codePoints > MAX_IMAGE_OCR_TEXT_LENGTH;

  return <section className="image-ocr-review" aria-label="Focused image OCR">
    <h3>VISIBLE TEXT / OCR</h3>
    {item.ocr.status === "off" ? <>
      <p>OCR is off. Run it locally only if visible text needs review.</p>
      <button type="button" onClick={onRun}>RUN OCR</button>
    </> : null}
    {item.ocr.status === "processing" ? <p role="status" aria-live="polite">OCR PROCESSING</p> : null}
    {item.ocr.status === "needs-review" ? <div className="image-ocr-needs-review">
      <strong className="image-review-state">NEEDS REVIEW</strong>
      <label>Detected OCR text<textarea aria-label="Detected OCR text" value={item.ocr.detectedText ?? ""} readOnly /></label>
      <label>Reviewed OCR text<textarea aria-label="Reviewed OCR text" value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
      <p>{codePoints.toLocaleString("en-US")} / {MAX_IMAGE_OCR_TEXT_LENGTH.toLocaleString("en-US")} code points</p>
      {overLimit ? <p className="image-review-guidance">NEEDS REVIEW · Shorten the reviewed OCR before accepting.</p> : null}
      <div className="image-ocr-actions">
        <button type="button" disabled={overLimit} onClick={() => onReview("accepted", draft)}>ACCEPT REVIEWED OCR</button>
        <button type="button" onClick={() => onReview("rejected", null)}>REJECT OCR</button>
      </div>
    </div> : null}
    {item.ocr.status === "failed" ? <>
      <strong className="image-error-state">OCR FAILED</strong>
      <button type="button" onClick={onRun}>RETRY OCR</button>
    </> : null}
    {item.ocr.status === "accepted" ? <>
      <strong>OCR ACCEPTED</strong>
      <button type="button" onClick={onRun}>RUN OCR AGAIN</button>
    </> : null}
    {item.ocr.status === "rejected" ? <>
      <strong>OCR REJECTED</strong>
      <button type="button" onClick={onRun}>RUN OCR AGAIN</button>
    </> : null}
  </section>;
}
