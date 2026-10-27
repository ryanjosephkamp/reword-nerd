import { boundedCount, boundedText, COLLECTION_LIMITS as L } from "./limits";
export type WireValue = null | boolean | number | string | WireValue[] | { [key: string]: WireValue };
export function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export function unbase64(value: string, max: number): Uint8Array {
  if (typeof value !== "string" || value.length > Math.ceil(max / 3) * 4 || value.length % 4 !== 0 || /[^A-Za-z0-9+/=]/u.test(value) || (value.indexOf("=") >= 0 && !/^={1,2}$/u.test(value.slice(value.indexOf("="))))) throw Error("Malformed or oversized base64 artifact");
  const result = Uint8Array.from(atob(value), c => c.charCodeAt(0));
  boundedCount(result.length, max, "Decoded artifact");
  if (base64(result) !== value) throw Error("Noncanonical base64 artifact");
  return result;
}
export function canonical(value: unknown): string {
  const visit = (v: unknown, depth: number): unknown => {
    if (depth > 32) throw Error("Metadata nesting limit");
    if (v === null || typeof v === "boolean" || typeof v === "string") return v;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (Array.isArray(v)) return v.map(x => visit(x, depth + 1));
    if (typeof v === "object" && v) return Object.fromEntries(Object.keys(v).sort().filter(k => (v as Record<string, unknown>)[k] !== undefined).map(k => {
      if (["__proto__", "constructor", "prototype"].includes(k)) throw Error("Unsafe metadata key");
      return [k, visit((v as Record<string, unknown>)[k], depth + 1)];
    }));
    throw Error("Unsupported metadata value");
  };
  return JSON.stringify(visit(value, 0));
}
export async function digest(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : Uint8Array.from(value);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), n => n.toString(16).padStart(2, "0")).join("");
}
/** Only in-memory public preparation objects; never paths or filesystem handles. */
export async function toWire(value: unknown, depth = 0): Promise<WireValue> {
  if (depth > 24) throw Error("Preparation nesting limit");
  if (value instanceof Uint8Array) { boundedCount(value.length, L.originalBytes, "Original bytes"); return { $bytes: base64(value) }; }
  if (value instanceof Blob || (value && typeof value === "object" && "arrayBuffer" in value && typeof value.arrayBuffer === "function")) {
    const blob = value as File;
    boundedCount(blob.size, L.originalBytes, "Original bytes");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length !== blob.size) throw Error("Original changed while preparing");
    return { $blob: base64(bytes), type: blob.type ?? "", ...(typeof blob.name === "string" ? { name: blob.name } : {}) };
  }
  if (Array.isArray(value)) { boundedCount(value.length, 512, "Preparation array"); return Promise.all(value.map(v => toWire(v, depth + 1))); }
  if (value && typeof value === "object") {
    const pairs = [];
    for (const [key, v] of Object.entries(value)) {
      if (v === undefined) continue;
      if (key.startsWith("$") || ["__proto__", "constructor", "prototype"].includes(key)) throw Error("Unsafe preparation key");
      pairs.push([key, await toWire(v, depth + 1)]);
    }
    return Object.fromEntries(pairs);
  }
  if (typeof value === "string") boundedText(value, L.hydratedPromptBytes, "Preparation field");
  if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return value;
  throw Error("Unsupported public preparation value");
}
export function fromWire(value: WireValue, depth = 0): unknown {
  if (depth > 24) throw Error("Preparation nesting limit");
  if (Array.isArray(value)) { boundedCount(value.length, 512, "Preparation array"); return value.map(v => fromWire(v, depth + 1)); }
  if (value && typeof value === "object") {
    if ("$bytes" in value) {
      if (Object.keys(value).join() !== "$bytes") throw Error("Invalid bytes record");
      return unbase64(value.$bytes as string, L.originalBytes);
    }
    if ("$blob" in value) {
      if (Object.keys(value).some(k => !["$blob", "type", "name"].includes(k)) || typeof value.type !== "string" || (value.name !== undefined && typeof value.name !== "string")) throw Error("Invalid blob record");
      const bytes = unbase64(value.$blob as string, L.originalBytes);
      return value.name === undefined ? new Blob([Uint8Array.from(bytes)], { type: value.type }) : new File([Uint8Array.from(bytes)], value.name, { type: value.type });
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => {
      if (k.startsWith("$") || ["__proto__", "constructor", "prototype"].includes(k)) throw Error("Unsafe preparation key");
      return [k, fromWire(v, depth + 1)];
    }));
  }
  return value;
}
