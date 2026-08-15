import { useEffect, useMemo, useRef, useState } from "react";
import type { ImageBuiltPairPreview, ImageClipboardResult } from "../export";
import type { ImageObjectUrlRegistry } from "../objectUrlRegistry";
import {
  updateImagePackagePreviewWindow,
} from "./packagePreviewWindow";
import { useImageObjectUrl } from "./useImageObjectUrl";

function provenanceLabel(pair: ImageBuiltPairPreview): string {
  const label = pair.provenance.sourcePath
    ?? pair.provenance.containerChain.map((node) => node.name).join(" › ");
  return label || "Direct image";
}

function selectPrompt(node: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;
  node.focus();
  const range = document.createRange();
  range.selectNodeContents(node);
  selection.removeAllRanges();
  selection.addRange(range);
}

function ImagePackagePreviewCard({
  pair,
  objectUrls,
  leaseEnabled,
  copyPrompt,
  copyImage,
}: {
  pair: ImageBuiltPairPreview;
  objectUrls: ImageObjectUrlRegistry;
  leaseEnabled: boolean;
  copyPrompt(text: string): Promise<ImageClipboardResult>;
  copyImage(source: Blob, rendered: HTMLImageElement): Promise<ImageClipboardResult>;
}) {
  const [status, setStatus] = useState("");
  const promptRef = useRef<HTMLPreElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const url = useImageObjectUrl(objectUrls, {
    occurrenceId: pair.occurrenceId,
    sourceHash: pair.sourceHash,
    purpose: "download",
    sourceBytes: pair.sourceBytes,
    enabled: leaseEnabled,
  });

  const copyBuiltPrompt = async () => {
    const result = await copyPrompt(pair.prompt);
    if (result.ok) setStatus("Prompt copied.");
    else {
      if (promptRef.current) selectPrompt(promptRef.current);
      setStatus("Prompt selected — copy manually.");
    }
  };
  const copyBuiltImage = async () => {
    if (!imageRef.current) {
      setStatus("Copy unavailable — use Open Image, Download Image, or drag the image.");
      return;
    }
    const result = await copyImage(pair.sourceBytes, imageRef.current);
    setStatus(result.ok
      ? "Image copied."
      : "Copy unavailable — use Open Image, Download Image, or drag the image.");
  };

  return <article
    className="image-built-pair-card"
    role="group"
    aria-label={`${pair.displayName} built package pair`}
    data-package-pair-key={pair.key}
  >
    <header><p className="image-eyebrow">PAIR {String(pair.key).slice(0, 3)}</p><h4>{pair.displayName}</h4></header>
    <div className="image-built-source-frame">
      {url ? <img
        ref={imageRef}
        src={url}
        alt={`Built source ${pair.displayName}`}
        draggable="true"
      /> : <span aria-hidden="true">LOCAL IMAGE</span>}
    </div>
    <dl>
      <div><dt>Provenance</dt><dd>{provenanceLabel(pair)}</dd></div>
      <div><dt>Model</dt><dd>{pair.profileLabel}</dd></div>
    </dl>
    {pair.warnings.map((warning) => <p className="image-warning" key={warning}>WARNING · {warning}</p>)}
    <section><h5>EXACT BUILT PROMPT</h5><pre ref={promptRef} tabIndex={0}>{pair.prompt}</pre></section>
    <section><h5>BUILT PROVIDER RUN CARD</h5><pre>{pair.runCard}</pre></section>
    <div className="image-built-pair-actions">
      <button type="button" onClick={() => { void copyBuiltPrompt(); }}>COPY PROMPT</button>
      <button type="button" disabled={!url} onClick={() => { void copyBuiltImage(); }}>COPY IMAGE</button>
      {url ? <>
        <a href={url} target="_blank" rel="noopener">OPEN IMAGE</a>
        <a href={url} download={pair.sourceFilename}>DOWNLOAD IMAGE</a>
      </> : null}
    </div>
    <p className="image-built-pair-status" role="status" aria-live="polite">{status}</p>
  </article>;
}

export function ImagePackagePreview({
  pairs,
  objectUrls,
  leaseEnabled,
  copyPrompt,
  copyImage,
}: {
  pairs: readonly ImageBuiltPairPreview[];
  objectUrls: ImageObjectUrlRegistry;
  leaseEnabled: boolean;
  copyPrompt(text: string): Promise<ImageClipboardResult>;
  copyImage(source: Blob, rendered: HTMLImageElement): Promise<ImageClipboardResult>;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [recency, setRecency] = useState<readonly string[]>([]);
  const pairKeys = useMemo(() => pairs.map((pair) => pair.key), [pairs]);
  const observerAvailable = typeof IntersectionObserver === "function";
  const previewWindow = updateImagePackagePreviewWindow({
    pairKeys,
    nearVisibleKeys: [],
    previousRecency: recency,
    observerAvailable,
  });
  const activeKeys = new Set(previewWindow.activeKeys);

  useEffect(() => {
    const list = listRef.current;
    const scrollRoot = list?.closest<HTMLElement>(".image-panel");
    if (!leaseEnabled || !observerAvailable || !list || !scrollRoot) return;
    const observedKeys = [...pairKeys];
    const observer = new IntersectionObserver((entries) => {
      const nearVisibleKeys = entries.flatMap((entry) => {
        if (!entry.isIntersecting || !(entry.target instanceof HTMLElement)) return [];
        return entry.target.dataset.packagePairKey ? [entry.target.dataset.packagePairKey] : [];
      });
      if (nearVisibleKeys.length === 0) return;
      setRecency((current) => updateImagePackagePreviewWindow({
        pairKeys: observedKeys,
        nearVisibleKeys,
        previousRecency: current,
        observerAvailable: true,
      }).recency);
    }, { root: scrollRoot, rootMargin: "180px 0px" });
    for (const card of list.querySelectorAll<HTMLElement>("[data-package-pair-key]")) observer.observe(card);
    return () => observer.disconnect();
  }, [leaseEnabled, observerAvailable, pairKeys]);

  if (pairs.length === 0) return null;
  return <section className="image-built-package-preview" aria-label="Built package pairs">
    <header><p className="image-eyebrow">BUILT SNAPSHOT</p><h3>PACKAGE PAIRS</h3></header>
    <div className="image-built-pair-list" ref={listRef}>
      {pairs.map((pair) => <ImagePackagePreviewCard
        key={`${pair.key}:${pair.occurrenceId}:${pair.sourceHash}`}
        pair={pair}
        objectUrls={objectUrls}
        leaseEnabled={leaseEnabled && activeKeys.has(pair.key)}
        copyPrompt={copyPrompt}
        copyImage={copyImage}
      />)}
    </div>
  </section>;
}
