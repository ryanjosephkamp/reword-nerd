import { useEffect, useRef, useState } from "react";
import type { ImagePortalItem } from "../contracts";
import type { ImageObjectUrlRegistry } from "../objectUrlRegistry";
import { updateImageThumbnailWindow } from "./thumbnailWindow";
import { useImageObjectUrl } from "./useImageObjectUrl";

function formatBytes(value: number): string {
  return value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KiB`;
}

function ImageQueueRow({
  item,
  focused,
  thumbnailEnabled,
  objectUrls,
  onFocus,
  onSelect,
  onInclusion,
  onRemove,
}: {
  item: Readonly<ImagePortalItem>;
  focused: boolean;
  thumbnailEnabled: boolean;
  objectUrls: ImageObjectUrlRegistry;
  onFocus(): void;
  onSelect(selected: boolean): void;
  onInclusion(included: boolean): void;
  onRemove(trigger: HTMLButtonElement): void;
}) {
  const name = item.provenance.sourceName;
  const thumbnailUrl = useImageObjectUrl(objectUrls, {
    occurrenceId: item.id,
    sourceHash: item.sourceHash,
    purpose: "thumbnail",
    sourceBytes: item.sourceBytes,
    enabled: thumbnailEnabled,
  });
  return <article
    className={`image-queue-row${focused ? " is-focused" : ""}`}
    role="group"
    aria-label={`${name} image controls`}
    data-image-id={item.id}
  >
    <button
      id={`image-focus-${item.id}`}
      type="button"
      className="image-row-focus-surface"
      aria-label={`Focus ${name}`}
      aria-current={focused ? "true" : undefined}
      onClick={onFocus}
    >
      <span className="image-thumbnail-frame">
        {thumbnailUrl ? <img src={thumbnailUrl} alt="" /> : <span aria-hidden="true">▧</span>}
      </span>
      <span className="image-row-copy">
        <strong>{name}</strong>
        <span>{item.dimensions.width} × {item.dimensions.height} · {formatBytes(item.byteCount)}</span>
        <span>{item.provenance.intakeKind.toUpperCase()} · OCR {item.ocr.status.toUpperCase()}</span>
        {item.provenance.sourcePath ? <span>{item.provenance.sourcePath}</span> : null}
        {item.provenance.containerChain.length > 0
          ? <span>{item.provenance.containerChain.map((node) => node.name).join(" › ")}</span>
          : null}
        {item.warnings.map((warning) => <span className="image-warning" key={warning}>WARNING · {warning}</span>)}
        <span className={item.included ? "image-included" : "image-omitted"}>{item.included ? "INCLUDED" : "OMITTED"}</span>
      </span>
    </button>
    <div className="image-row-controls">
      <label><input type="checkbox" aria-label={`Select ${name}`} checked={item.bulkSelected} onChange={(event) => onSelect(event.target.checked)} /> SELECT</label>
      <button type="button" aria-label={`${item.included ? "Omit" : "Include"} ${name}`} onClick={() => onInclusion(!item.included)}>{item.included ? "OMIT" : "INCLUDE"}</button>
      <button type="button" aria-label={`Remove ${name}`} onClick={(event) => onRemove(event.currentTarget)}>REMOVE</button>
    </div>
  </article>;
}

export function ImageQueuePanel({
  items,
  focusedItemId,
  thumbnailLeasesEnabled,
  objectUrls,
  onFocus,
  onSelect,
  onInclusion,
  onRequestRemove,
  onRunOcr,
}: {
  items: readonly ImagePortalItem[];
  focusedItemId: string | null;
  thumbnailLeasesEnabled: boolean;
  objectUrls: ImageObjectUrlRegistry;
  onFocus(itemId: string): void;
  onSelect(itemId: string, selected: boolean): void;
  onInclusion(itemId: string, included: boolean): void;
  onRequestRemove(itemIds: readonly string[], trigger: HTMLButtonElement): void;
  onRunOcr(itemIds: readonly string[]): void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [recency, setRecency] = useState<readonly string[]>([]);
  const itemIds = items.map((item) => item.id);
  const observerAvailable = typeof IntersectionObserver === "function";
  const thumbnailWindow = updateImageThumbnailWindow({
    itemIds,
    focusedId: focusedItemId,
    nearVisibleIds: [],
    previousRecency: recency,
    observerAvailable,
  });
  const activeThumbnailIds = new Set(thumbnailWindow.activeIds);

  useEffect(() => {
    const list = listRef.current;
    const scrollRoot = list?.closest<HTMLElement>(".image-panel");
    if (!observerAvailable || !list || !scrollRoot) return;
    const observedItemIds = items.map((item) => item.id);
    const observer = new IntersectionObserver((entries) => {
      const nearVisibleIds = entries.flatMap((entry) => {
        if (!entry.isIntersecting || !(entry.target instanceof HTMLElement)) return [];
        return entry.target.dataset.imageId ? [entry.target.dataset.imageId] : [];
      });
      if (nearVisibleIds.length === 0) return;
      setRecency((current) => updateImageThumbnailWindow({
        itemIds: observedItemIds,
        focusedId: focusedItemId,
        nearVisibleIds,
        previousRecency: current,
        observerAvailable: true,
      }).recency);
    }, { root: scrollRoot, rootMargin: "180px 0px" });
    for (const row of list.querySelectorAll<HTMLElement>("[data-image-id]")) observer.observe(row);
    return () => observer.disconnect();
  }, [focusedItemId, items, observerAvailable]);

  const selected = items.filter((item) => item.bulkSelected);
  return <>
    {selected.length > 0 ? <div className="image-bulk-toolbar" aria-label="Selected image actions">
      <strong>{selected.length} SELECTED</strong>
      <button type="button" onClick={() => selected.forEach((item) => onInclusion(item.id, true))}>INCLUDE {selected.length}</button>
      <button type="button" onClick={() => selected.forEach((item) => onInclusion(item.id, false))}>OMIT {selected.length}</button>
      <button type="button" onClick={(event) => onRequestRemove(selected.map((item) => item.id), event.currentTarget)}>REMOVE {selected.length}</button>
      <button type="button" onClick={() => onRunOcr(selected.map((item) => item.id))}>RUN OCR ON {selected.length}</button>
    </div> : null}
    <div className="image-queue-list" ref={listRef}>
      {items.map((item) => <ImageQueueRow
        key={`${item.id}:${item.sourceHash}`}
        item={item}
        focused={focusedItemId === item.id}
        thumbnailEnabled={thumbnailLeasesEnabled && activeThumbnailIds.has(item.id)}
        objectUrls={objectUrls}
        onFocus={() => onFocus(item.id)}
        onSelect={(selectedValue) => onSelect(item.id, selectedValue)}
        onInclusion={(included) => onInclusion(item.id, included)}
        onRemove={(trigger) => onRequestRemove([item.id], trigger)}
      />)}
    </div>
  </>;
}
