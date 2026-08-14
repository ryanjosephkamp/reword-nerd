import type { ImageMimeType } from "../contracts";
import { IMAGE_FULL_HTML_MAX_BYTES } from "./contracts";

export interface ImageHtmlPair {
  readonly ordinal: number;
  readonly key: string;
  readonly displayName: string;
  readonly sourceReference: string;
  readonly sourceBytes: Blob;
  readonly mimeType: ImageMimeType;
  readonly provenanceLabel: string;
  readonly profileLabel: string;
  readonly prompt: string;
  readonly runCard: string;
  readonly warnings: readonly string[];
  readonly officialSourceUrls: readonly string[];
}

export type ImageFullHtmlRenderResult =
  | { readonly status: "generated"; readonly html: string; readonly byteCount: number }
  | { readonly status: "omitted"; readonly projectedByteCount: number };

const encoder = new TextEncoder();
const SOURCE_REFERENCE_OCCURRENCES_PER_CARD = 3;
const CSP = "default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; media-src 'none'; font-src 'none'; base-uri 'none'";
const PAIR_KEY_PATTERN = /^\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MIME_EXTENSIONS: Readonly<Record<ImageMimeType, readonly string[]>> = Object.freeze({
  "image/png": Object.freeze(["png"]),
  "image/jpeg": Object.freeze(["jpg", "jpeg"]),
  "image/webp": Object.freeze(["webp"]),
  "image/avif": Object.freeze(["avif"]),
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function renderWarnings(warnings: readonly string[]): string {
  if (warnings.length === 0) return "";
  return `<section aria-label="Warnings"><h3>Warnings</h3><ul>${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul></section>`;
}

function renderSources(urls: readonly string[]): string {
  if (urls.length === 0) return "";
  return `<section aria-label="Official guidance"><h3>Official guidance</h3><ul>${urls.map((url) => `<li><code>${escapeHtml(url)}</code></li>`).join("")}</ul></section>`;
}

function isValidBase64(value: string): boolean {
  return value.length % 4 === 0
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value);
}

function isSafeImageSourceReference(pair: ImageHtmlPair, reference: string): boolean {
  if (!PAIR_KEY_PATTERN.test(pair.key)) return false;
  const extensions = MIME_EXTENSIONS[pair.mimeType];
  if (extensions.some((extension) => reference === `pairs/${pair.key}/source.${extension}`
    || reference === `./source.${extension}`)) return true;
  const prefix = `data:${pair.mimeType};base64,`;
  return reference.startsWith(prefix) && isValidBase64(reference.slice(prefix.length));
}

function assertSafeImageSourceReference(pair: ImageHtmlPair): void {
  if (!isSafeImageSourceReference(pair, pair.sourceReference)) {
    throw new Error("IMAGE_HTML_SOURCE_REFERENCE_INVALID");
  }
}

function renderCard(pair: ImageHtmlPair, sourceReference: string): string {
  const ordinal = String(pair.ordinal).padStart(3, "0");
  const imageId = `source-image-${ordinal}`;
  const promptId = `prompt-${ordinal}`;
  const statusId = `status-${ordinal}`;
  const escapedReference = escapeHtml(sourceReference);
  return `<article class="image-package-card" aria-labelledby="pair-title-${ordinal}">
  <header><p class="eyebrow">PAIR ${ordinal}</p><h2 id="pair-title-${ordinal}">${escapeHtml(pair.displayName)}</h2></header>
  <div class="image-frame"><img id="${imageId}" src="${escapedReference}" alt="Source image for ${escapeHtml(pair.displayName)}" draggable="true"></div>
  <dl><div><dt>Provenance</dt><dd>${escapeHtml(pair.provenanceLabel)}</dd></div><div><dt>Model</dt><dd>${escapeHtml(pair.profileLabel)}</dd></div></dl>
  ${renderWarnings(pair.warnings)}
  ${renderSources(pair.officialSourceUrls)}
  <section><h3>Run card</h3><pre>${escapeHtml(pair.runCard)}</pre></section>
  <section><h3>Exact prompt</h3><pre id="${promptId}" tabindex="0">${escapeHtml(pair.prompt)}</pre></section>
  <div class="controls" aria-label="Pair actions">
    <button type="button" data-copy-prompt="${promptId}" data-status="${statusId}">COPY PROMPT</button>
    <button type="button" data-copy-image="${imageId}" data-status="${statusId}">COPY IMAGE</button>
    <a href="${escapedReference}" target="_blank" rel="noopener">OPEN IMAGE</a>
    <a href="${escapedReference}" download>DOWNLOAD IMAGE</a>
  </div>
  <p id="${statusId}" class="status" role="status" aria-live="polite"></p>
</article>`;
}

const STYLE = `<style>
:root{color-scheme:dark;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:#090b10;color:#f5f7fb}*{box-sizing:border-box}body{margin:0;padding:clamp(16px,4vw,48px);background:#090b10}main{width:min(1120px,100%);margin:0 auto}h1,h2,h3,p{overflow-wrap:anywhere}.intro{color:#b5bdc9;max-width:76ch}.cards{display:grid;gap:24px}.image-package-card{min-width:0;border:1px solid #374151;background:#11151f;padding:clamp(14px,3vw,24px)}.eyebrow,dt{color:#ff9f1c;font-weight:700}.image-frame{display:grid;place-items:center;min-height:160px;background:#05070b;border:1px solid #2a3444}.image-frame img{display:block;max-width:100%;max-height:68vh;object-fit:contain}dl{display:grid;gap:8px}dl div{display:grid;grid-template-columns:minmax(88px,auto) 1fr;gap:12px}dd{margin:0;overflow-wrap:anywhere}pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #2a3444;background:#080a0f;padding:14px;max-width:100%;overflow:auto}.controls{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}.controls button,.controls a{appearance:none;border:1px solid #ff9f1c;background:#19130a;color:#ffb347;padding:10px 12px;font:inherit;text-decoration:none;cursor:pointer}.controls button:focus-visible,.controls a:focus-visible,pre:focus-visible{outline:3px solid #ffd166;outline-offset:3px}.status{min-height:1.4em;color:#ffd166}@media(max-width:420px){body{padding:12px}.image-package-card{padding:12px}dl div{grid-template-columns:1fr}.controls>*{flex:1 1 100%;text-align:center}}
</style>`;

const SCRIPT = `<script>
(()=>{const setStatus=(id,text)=>{const node=document.getElementById(id);if(node)node.textContent=text;};const selectPrompt=(node)=>{const selection=window.getSelection();if(!selection)return;const range=document.createRange();range.selectNodeContents(node);selection.removeAllRanges();selection.addRange(range);node.focus();};document.addEventListener('click',async(event)=>{const target=event.target;if(!(target instanceof HTMLElement))return;const promptId=target.dataset.copyPrompt;if(promptId){const prompt=document.getElementById(promptId);if(!prompt)return;let copied=false;try{if(navigator.clipboard&&navigator.clipboard.writeText){await navigator.clipboard.writeText(prompt.textContent||'');copied=true;}}catch{copied=false;}if(copied)setStatus(target.dataset.status||'','Prompt copied.');else{selectPrompt(prompt);setStatus(target.dataset.status||'','Prompt selected — copy manually.');}return;}const imageId=target.dataset.copyImage;if(!imageId)return;const image=document.getElementById(imageId);if(!(image instanceof HTMLImageElement))return;try{if(!navigator.clipboard||!navigator.clipboard.write||typeof ClipboardItem==='undefined')throw new Error('unsupported');const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d');if(!context)throw new Error('canvas');context.drawImage(image,0,0);const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('png')),'image/png'));await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);setStatus(target.dataset.status||'','Image copied.');}catch{setStatus(target.dataset.status||'','Copy unavailable — use Open Image, Download Image, or drag the image.');}});})();
</script>`;

function renderDocument(title: string, pairs: readonly ImageHtmlPair[], sourceReferences: readonly string[]): string {
  if (pairs.length !== sourceReferences.length) throw new Error("IMAGE_HTML_PAIR_MISMATCH");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(CSP)}"><title>${escapeHtml(title)}</title>${STYLE}</head>
<body><main><header><p class="eyebrow">REWORD NERD / IMAGE</p><h1>${escapeHtml(title)}</h1><p class="intro">Each card pairs exactly one local source image with one exact prompt and provider run card. Image generation is stochastic; review faces, text, logos, geometry, and layouts before use.</p></header><section class="cards" aria-label="Image prompt pairs">${pairs.map((pair, index) => renderCard(pair, sourceReferences[index])).join("")}</section></main>${SCRIPT}</body></html>`;
}

export function renderImageRootHtml(pairs: readonly ImageHtmlPair[]): string {
  pairs.forEach(assertSafeImageSourceReference);
  return renderDocument("Image prompt package", pairs, pairs.map((pair) => pair.sourceReference));
}

export function renderImagePairHtml(pair: ImageHtmlPair): string {
  assertSafeImageSourceReference(pair);
  return renderDocument(pair.displayName, [pair], [pair.sourceReference]);
}

export function decideImageFullHtmlSize(
  nonImageUtf8ByteCount: number,
  sources: readonly { readonly byteCount: number; readonly mimeType: ImageMimeType }[],
):
  | { readonly status: "generated"; readonly projectedByteCount: number }
  | { readonly status: "omitted"; readonly projectedByteCount: number } {
  if (!Number.isSafeInteger(nonImageUtf8ByteCount) || nonImageUtf8ByteCount < 0) {
    throw new Error("IMAGE_FULL_HTML_SIZE_INVALID");
  }
  let projectedByteCount = nonImageUtf8ByteCount;
  for (const source of sources) {
    if (!Number.isSafeInteger(source.byteCount) || source.byteCount < 0) {
      throw new Error("IMAGE_FULL_HTML_SIZE_INVALID");
    }
    const oneReference = encoder.encode(`data:${source.mimeType};base64,`).byteLength
      + 4 * Math.ceil(source.byteCount / 3);
    projectedByteCount += SOURCE_REFERENCE_OCCURRENCES_PER_CARD * oneReference;
    if (!Number.isSafeInteger(projectedByteCount)) throw new Error("IMAGE_FULL_HTML_SIZE_INVALID");
  }
  return {
    status: projectedByteCount <= IMAGE_FULL_HTML_MAX_BYTES ? "generated" : "omitted",
    projectedByteCount,
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Image package build cancelled.", "AbortError");
}

export async function renderImageFullHtml(
  pairs: readonly ImageHtmlPair[],
  signal?: AbortSignal,
): Promise<ImageFullHtmlRenderResult> {
  throwIfAborted(signal);
  const placeholders = pairs.map((_, index) => `__IMAGE_DATA_URL_${String(index).padStart(3, "0")}__`);
  const template = renderDocument("Image prompt package — self-contained", pairs, placeholders);
  const placeholderBytes = placeholders.reduce(
    (total, placeholder) => total + SOURCE_REFERENCE_OCCURRENCES_PER_CARD * encoder.encode(placeholder).byteLength,
    0,
  );
  const nonImageUtf8ByteCount = encoder.encode(template).byteLength - placeholderBytes;
  const decision = decideImageFullHtmlSize(
    nonImageUtf8ByteCount,
    pairs.map((pair) => ({ byteCount: pair.sourceBytes.size, mimeType: pair.mimeType })),
  );
  if (decision.status === "omitted") return decision;

  const references: string[] = [];
  for (const pair of pairs) {
    throwIfAborted(signal);
    let buffer: ArrayBuffer;
    try {
      buffer = await pair.sourceBytes.arrayBuffer();
    } catch (error) {
      throwIfAborted(signal);
      throw error;
    }
    throwIfAborted(signal);
    const bytes = new Uint8Array(buffer);
    references.push(`data:${pair.mimeType};base64,${bytesToBase64(bytes)}`);
  }
  const html = renderDocument("Image prompt package — self-contained", pairs, references);
  const byteCount = encoder.encode(html).byteLength;
  if (byteCount !== decision.projectedByteCount || byteCount > IMAGE_FULL_HTML_MAX_BYTES) {
    throw new Error("IMAGE_FULL_HTML_SIZE_MISMATCH");
  }
  return { status: "generated", html, byteCount };
}
