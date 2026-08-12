import { useEffect, useMemo } from "react";
import type { VisualAsset } from "../../../domain";
import { ImageIcon, MoreIcon } from "./Icons";

const previewable = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function AssetThumbnail({ asset }: { asset: VisualAsset }) {
  const url = useMemo(() => previewable.has(asset.mimeType)
    ? URL.createObjectURL(new Blob([asset.bytes.slice()], { type: asset.mimeType }))
    : undefined, [asset.bytes, asset.mimeType]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return url
    ? <img src={url} alt={asset.altText || asset.caption || `${asset.filename} preview`} />
    : <div className="asset-placeholder" aria-label={`${asset.filename} cannot be previewed safely`}><ImageIcon /></div>;
}

export function AssetGallery({ assets, onInclusionChange }: {
  assets: readonly VisualAsset[];
  onInclusionChange(assetId: string, included: boolean): void;
}) {
  if (assets.length === 0) return <div className="assets-empty"><ImageIcon /><p>No extracted visual assets.</p><span>Enable image extraction in Settings, then reprocess this document.</span></div>;
  return <section className="asset-gallery" aria-label="Extracted visual assets">
    <div className="asset-gallery-intro">
      <h3>VISUAL ASSETS [{assets.length}]</h3>
      <p>Review what will be packaged and manually attached to a model that accepts image input.</p>
    </div>
    <div className="asset-cards">
      {assets.map((asset) => <article className={`asset-card${asset.included ? " is-included" : " is-omitted"}`} key={asset.id}>
        <header><div><strong>{asset.caption || asset.filename}</strong><span>{asset.pageNumber ? `p. ${asset.pageNumber}` : asset.sourcePath || asset.kind}</span></div><MoreIcon /></header>
        <AssetThumbnail asset={asset} />
        <footer>
          <code>{asset.id}</code>
          <label><input type="checkbox" checked={asset.included} onChange={(event) => onInclusionChange(asset.id, event.currentTarget.checked)} /> Include</label>
        </footer>
      </article>)}
    </div>
  </section>;
}
