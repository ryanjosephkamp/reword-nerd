import { useState } from "react";
import type { OcrCandidate, OcrReviewStatus } from "../../../domain";

export function OcrReview({ candidates, busyId, onReview }: {
  candidates: readonly OcrCandidate[];
  busyId: string | null;
  onReview(candidateId: string, status: OcrReviewStatus, text: string): void;
}) {
  if (candidates.length === 0) return null;
  return <section className="ocr-review" aria-label="OCR review candidates">
    <header><h3>OCR REVIEW [{candidates.filter((candidate) => candidate.status === "pending").length} PENDING]</h3><p>OCR text is never merged automatically. Edit it, then accept or omit each candidate.</p></header>
    {candidates.map((candidate) => <OcrCandidateEditor candidate={candidate} busy={busyId !== null} onReview={onReview} key={`${candidate.id}:${candidate.status}`} />)}
  </section>;
}

function OcrCandidateEditor({ candidate, busy, onReview }: {
  candidate: OcrCandidate;
  busy: boolean;
  onReview(candidateId: string, status: OcrReviewStatus, text: string): void;
}) {
  const [draft, setDraft] = useState(candidate.reviewedText);
  const label = candidate.source.kind === "page" ? `Page ${candidate.source.pageNumber}` : `Asset ${candidate.source.assetId}`;
  return <article className={`ocr-candidate status-${candidate.status}`}>
    <div><strong>{label}</strong><span>{Math.round(candidate.confidence)}% confidence · {candidate.status}</span></div>
    <textarea aria-label={`Reviewed OCR text for ${label}`} value={draft} onChange={(event) => setDraft(event.currentTarget.value)} />
    <div>
      <button type="button" disabled={busy || !draft.trim()} onClick={() => onReview(candidate.id, "accepted", draft)}>Accept OCR</button>
      <button type="button" disabled={busy} onClick={() => onReview(candidate.id, "omitted", draft)}>Omit</button>
    </div>
  </article>;
}
