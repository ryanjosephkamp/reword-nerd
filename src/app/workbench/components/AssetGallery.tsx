import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { VisualAsset } from "../../../domain";
import type { AssetViewMode } from "../contracts";
import { ImageIcon } from "./Icons";

const previewable = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function createAssetObjectUrlStore(bytes: Uint8Array, mimeType: string) {
  let url: string | undefined;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => url,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      if (!url && previewable.has(mimeType)) {
        url = URL.createObjectURL(new Blob([bytes.slice()], { type: mimeType }));
        listener();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && url) {
          URL.revokeObjectURL(url);
          url = undefined;
        }
      };
    },
  };
}

function AssetThumbnail({ asset }: { asset: VisualAsset }) {
  const objectUrlStore = useMemo(
    () => createAssetObjectUrlStore(asset.bytes, asset.mimeType),
    [asset.bytes, asset.mimeType],
  );
  const url = useSyncExternalStore(objectUrlStore.subscribe, objectUrlStore.getSnapshot, objectUrlStore.getSnapshot);
  return url
    ? <img src={url} alt={asset.altText || asset.caption || `${asset.filename} preview`} loading="lazy" decoding="async" />
    : <div className="asset-placeholder" aria-label={`${asset.filename} cannot be previewed safely`}><ImageIcon /></div>;
}

function LazyAssetThumbnail({ asset }: { asset: VisualAsset }) {
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  const anchorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (visible || !anchorRef.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setVisible(true);
      observer.disconnect();
    }, { rootMargin: "160px" });
    observer.observe(anchorRef.current);
    return () => observer.disconnect();
  }, [visible]);
  return <div className="asset-lazy-thumbnail" ref={anchorRef}>
    {visible ? <AssetThumbnail asset={asset} /> : <div className="asset-placeholder" aria-hidden="true"><ImageIcon /></div>}
  </div>;
}

function assetLabel(asset: VisualAsset) {
  return asset.altText || asset.caption || asset.filename;
}

function AssetDetail({ asset, onInclusionChange }: {
  asset: VisualAsset;
  onInclusionChange(assetId: string, included: boolean): void;
}) {
  const label = assetLabel(asset);
  return <article className={`asset-card asset-card-detail${asset.included ? " is-included" : " is-omitted"}`}>
    <header><div><h4>{label}</h4><span>{asset.pageNumber ? `p. ${asset.pageNumber}` : asset.sourcePath || asset.kind}</span></div></header>
    <AssetThumbnail asset={asset} />
    <footer>
      <code>{asset.id}</code>
      <label><input
        type="checkbox"
        aria-label={`Include ${label}`}
        checked={asset.included}
        onChange={(event) => onInclusionChange(asset.id, event.currentTarget.checked)}
      /> Include</label>
    </footer>
  </article>;
}

export function AssetGallery({ assets, view, selectedAssetId, onViewChange, onSelect, onInclusionChange }: {
  assets: readonly VisualAsset[];
  view: AssetViewMode;
  selectedAssetId: string | null;
  onViewChange(view: AssetViewMode): void;
  onSelect(assetId: string): void;
  onInclusionChange(assetId: string, included: boolean): void;
}) {
  if (assets.length === 0) return <div className="assets-empty"><ImageIcon /><p>No extracted visual assets.</p><span>Enable image extraction in Settings, then reprocess this document.</span></div>;
  const selectedIndex = Math.max(0, assets.findIndex((asset) => asset.id === selectedAssetId));
  const selected = assets[selectedIndex] ?? assets[0];
  return <section className="asset-gallery" aria-label="Extracted visual assets">
    <div className="asset-gallery-intro">
      <div><h3>VISUAL ASSETS [{assets.length}]</h3><p>Review what will be packaged and manually attached to a model that accepts image input.</p></div>
      <div className="asset-view-switch" role="group" aria-label="Asset view">
        <button type="button" aria-pressed={view === "detail"} onClick={() => onViewChange("detail")}>DETAIL</button>
        <button type="button" aria-pressed={view === "gallery"} onClick={() => onViewChange("gallery")}>GALLERY</button>
      </div>
    </div>
    {view === "detail" ? <div className="asset-detail-view">
      <div className="asset-detail-navigation">
        <button type="button" aria-label="Previous visual asset" disabled={selectedIndex === 0} onClick={() => onSelect(assets[selectedIndex - 1].id)}>←</button>
        <span aria-live="polite">{selectedIndex + 1} / {assets.length}</span>
        <button type="button" aria-label="Next visual asset" disabled={selectedIndex === assets.length - 1} onClick={() => onSelect(assets[selectedIndex + 1].id)}>→</button>
      </div>
      <AssetDetail asset={selected} onInclusionChange={onInclusionChange} />
    </div> : <ul className="asset-gallery-grid" aria-label="Visual asset gallery">
      {assets.map((asset) => {
        const label = assetLabel(asset);
        const isSelected = asset.id === selected.id;
        return <li key={asset.id} className={isSelected ? "is-selected" : ""}>
          <button
            type="button"
            aria-label={`Select ${label}, ${asset.included ? "included" : "omitted"}`}
            aria-pressed={isSelected}
            onClick={() => onSelect(asset.id)}
          >
            <LazyAssetThumbnail asset={asset} />
            <span><strong>{label}</strong><small>{asset.pageNumber ? `Page ${asset.pageNumber}` : asset.sourcePath || asset.kind}</small></span>
            <em>{asset.included ? "INCLUDED" : "OMITTED"}</em>
          </button>
        </li>;
      })}
    </ul>}
  </section>;
}
