import { ArrowSquareOut } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { DESTINATIONS, destination, type Destination } from "../../engine/handoff/destinations";
import {
  buildImagePrompt,
  buildImageTaskZip,
  effectiveSettings,
} from "../../engine/handoff/imagePrompt";
import type { ImageSource } from "../../engine/types";
import { CopyButton } from "../../ui/CopyButton";
import { DestinationPicker } from "../shared/DestinationPicker";
import { TaskSteps } from "../shared/TaskSteps";
import { ImageBringBack } from "./ImageBringBack";
import { useWorkspace } from "../store";

const IMAGE_DESTINATIONS = DESTINATIONS.filter((candidate) => candidate.forImages);

function PromptCard({
  image,
  target,
  current,
}: {
  image: ImageSource;
  target: Destination;
  current: boolean;
}) {
  const defaults = useWorkspace((state) => state.imageDefaults);
  const select = useWorkspace((state) => state.selectImage);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const prompt = useMemo(
    () => buildImagePrompt(image, effectiveSettings(image, defaults), target.id),
    [image, defaults, target.id],
  );

  if (!current) {
    return (
      <li className="prompt-row">
        <button type="button" className="link-button" onClick={() => select(image.id)}>
          {image.name}
        </button>
        <CopyButton text={prompt} label="Copy prompt" className="btn btn-quiet" />
      </li>
    );
  }

  return (
    <li className="prompt-card">
      <p className="step-title">{image.name}</p>
      <ol className="steps steps-compact">
        <li>Attach the image in {target.label}: drag it from the preview, or save it first.</li>
        <li>Paste this prompt and send.</li>
      </ol>
      <pre className="prompt-preview prompt-preview-short" tabIndex={0} aria-label="Prompt">
        {prompt}
      </pre>
      <div className="button-row">
        {target.url ? (
          <>
            <a
              className="btn btn-primary"
              href={target.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() =>
                navigator.clipboard.writeText(prompt).then(
                  () => setCopied("copied"),
                  () => setCopied("failed"),
                )
              }
            >
              <ArrowSquareOut aria-hidden />
              <span>Copy prompt and open {target.label}</span>
            </a>
            <CopyButton text={prompt} label="Copy only" />
          </>
        ) : (
          <CopyButton text={prompt} label="Copy prompt" className="btn btn-primary" />
        )}
      </div>
      {copied === "copied" && (
        <p className="callout" role="status">
          Prompt copied. Attach the image in {target.label}, then paste.
        </p>
      )}
      {copied === "failed" && (
        <p className="callout callout-error" role="alert">
          The browser didn't allow copying. Use “Copy only”.
        </p>
      )}
    </li>
  );
}

export function ImageHandoff({ selected }: { selected: ImageSource | null }) {
  const images = useWorkspace((state) => state.images);
  const defaults = useWorkspace((state) => state.imageDefaults);
  const destinationId = useWorkspace((state) => state.imageDestination);
  const setDestination = useWorkspace((state) => state.setImageDestination);
  const target = destination(destinationId);
  const included = images.filter((image) => image.included);

  return (
    <section className="panel-section" aria-labelledby="image-handoff-heading">
      <h2 id="image-handoff-heading" className="section-title">
        Hand it off
      </h2>
      <DestinationPicker
        name="image-destination"
        value={target}
        options={IMAGE_DESTINATIONS}
        groups={[
          { kind: "image", label: "Image tools" },
          { kind: "agent", label: "Coding agents that make images" },
        ]}
        onChange={(next) => setDestination(next.id)}
      />
      {included.length === 0 ? (
        <p className="muted">Include at least one image to hand off.</p>
      ) : target.kind === "agent" ? (
        <>
          <TaskSteps
            target={target}
            title={included.length === 1 ? included[0].name : "images"}
            build={(slug) => buildImageTaskZip(included, defaults, target.id, slug)}
            what={`It holds ${included.length === 1 ? "the image" : `all ${included.length} images`}, a prompt for each, and an output folder. Your agent makes every new version in one go.`}
          />
          <ImageBringBack images={included} />
        </>
      ) : (
        <ul className="prompt-list">
          {(selected && selected.included
            ? [selected, ...included.filter((image) => image.id !== selected.id)]
            : included
          ).map((image, index) => (
            <PromptCard key={image.id} image={image} target={target} current={index === 0} />
          ))}
        </ul>
      )}
    </section>
  );
}
