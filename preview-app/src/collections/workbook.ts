import runtime from "./workbookRuntime.generated.txt?raw";
import { canonical, digest, base64 } from "./codec";
import type { CollectionEnvelope } from "./prepare";
/** A deliberately separate, versioned collection workbook; legacy importers stay unchanged. */
export async function collectionWorkbook(envelope:CollectionEnvelope,rawResponses:Record<string,string>={}) {
  const rawResponseHashes=Object.fromEntries(await Promise.all(Object.entries(rawResponses).map(async([stage,raw])=>[stage,await digest(raw)])));
  const data={kind:"reword-collection-workbook",version:1,envelope,seal:await digest(canonical(envelope)),rawResponses,rawResponseHashes};
  const scriptHash=base64(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(runtime))));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>Reword Nerd collection workbook</title><style>body{font:16px/1.55 system-ui,sans-serif;margin:auto;padding:20px;max-width:960px;color:#172b29;background:#f5f6f0}pre,textarea{white-space:pre-wrap;overflow-wrap:anywhere;box-sizing:border-box;max-width:100%;width:100%;padding:12px}pre{background:#e7ece5;max-height:32rem;overflow:auto}button{padding:12px;margin:6px;min-height:44px}section{border-top:1px solid #879c94;padding:16px 0}summary{cursor:pointer}p,li{overflow-wrap:anywhere}:focus-visible{outline:3px solid #246e67}</style></head><body><main id="collection-app"></main><script type="application/json" id="collection-data">${canonical(data).replaceAll("<","\\u003c")}</script><script>${runtime}</script></body></html>`;
}
