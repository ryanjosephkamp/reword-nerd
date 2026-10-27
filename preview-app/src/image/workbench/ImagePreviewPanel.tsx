import type { ImagePortalItem } from "../contracts";
import type { ImageObjectUrlRegistry } from "../objectUrlRegistry";
import { imagePromptProfile } from "../profiles";
import { ImageOcrReview } from "./ImageOcrReview";
import { useImageObjectUrl } from "./useImageObjectUrl";

const EMPTY_IMAGE_BYTES = new Blob();

export function ImagePreviewPanel({
  item,
  objectUrls,
  leaseEnabled,
  onRunOcr,
  onReviewOcr,
}: {
  item: Readonly<ImagePortalItem> | null;
  objectUrls: ImageObjectUrlRegistry;
  leaseEnabled: boolean;
  onRunOcr(): void;
  onReviewOcr(status: "accepted" | "rejected", reviewedText: string | null): void;
}) {
  const url = useImageObjectUrl(objectUrls, {
    occurrenceId: item?.id ?? "none",
    sourceHash: item?.sourceHash ?? "none",
    purpose: "focused",
    sourceBytes: item?.sourceBytes ?? EMPTY_IMAGE_BYTES,
    enabled: leaseEnabled && item !== null,
  });
  if (!item) return <div className="image-empty-state"><p>Choose an image to inspect its source, prompt, and provider run card.</p></div>;
  const profile = imagePromptProfile(item.settings.modelFamily);
  return <div className="image-focused-source">
    {url ? <img src={url} alt={`Focused source ${item.provenance.sourceName}`} /> : null}
    <h3>{item.provenance.sourceName}</h3>
    <p>{item.dimensions.width} × {item.dimensions.height} · {item.byteCount} B</p>
    {item.warnings.map((warning) => <p className="image-warning" key={warning}>WARNING · {warning}</p>)}
    <ImageOcrReview
      key={`${item.id}:${item.incarnation}:${item.sourceHash}:${item.ocr.operationGeneration}:${item.ocr.status}`}
      item={item}
      onRun={onRunOcr}
      onReview={onReviewOcr}
    />
    <section className="image-prompt-card" role="region" aria-label="Prompt prose">
      <h3>PROMPT</h3>
      <pre>{profile.promptBuilder(item)}</pre>
    </section>
    <section className="image-run-card" role="region" aria-label="Provider run card">
      <h3>PROVIDER RUN CARD</h3>
      <pre>{profile.runCardBuilder(item)}</pre>
    </section>
  </div>;
}
