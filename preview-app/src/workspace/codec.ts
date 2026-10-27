export const WORKSPACE_LIMITS = Object.freeze({ bytes: 512 * 1024 * 1024, headerBytes: 32 * 1024 * 1024, nodes: 120_000, binaries: 4096, sections: 1024, depth: 100 });
const MAGIC = new TextEncoder().encode("RNWS0001");
// Control characters are deliberately rejected in serialized section names.
// eslint-disable-next-line no-control-regex
const sectionName = /^(studio|workbench|images|platform|appearance|collection|handoff|localText|imagePreparation|review|package|result)(:[^\u0000-\u001f\u007f]{1,4096})?$/u;
const unsafeKeys = new Set(["__proto__", "prototype", "constructor"]);
type Value = string | number | boolean | null | { ref: number };
type Node = { kind: string; value?: unknown; binary?: number; name?: string; type?: string; modified?: number };
interface Binary { bytes: number; sha256: string }
interface Payload { kind: "reword-nerd-workspace"; version: 1; root: Value; nodes: Node[]; binaries: Binary[] }
const blobHashes = new WeakMap<Blob, Promise<string>>();

export async function blobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error("Workspace file could not be read."));
    reader.readAsArrayBuffer(blob);
  });
}
export async function workspaceHash(bytes: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(n => n.toString(16).padStart(2, "0")).join("");
}
function hashBlob(blob: Blob): Promise<string> {
  let hash = blobHashes.get(blob);
  if (!hash) { hash = blobBytes(blob).then(workspaceHash); blobHashes.set(blob, hash); }
  return hash;
}
function sectionsValid(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid workspace sections.");
  const keys = Object.keys(value);
  if (keys.length > WORKSPACE_LIMITS.sections || keys.some(k => !sectionName.test(k))) throw Error("Unsupported workspace section or section limit exceeded.");
}
function keyValid(key: unknown): asserts key is string {
  if (typeof key !== "string" || unsafeKeys.has(key)) throw Error("Unsafe workspace prototype key.");
}

/** A bounded data container. It stores bytes and inert values, never executable handles. */
export async function encodeWorkspace(sections: Record<string, unknown>): Promise<Blob> {
  sectionsValid(sections);
  const nodes: Node[] = [], binaries: Binary[] = [], parts: Blob[] = [];
  const active = new WeakSet<object>();
  const seen = new Map<object, number>(), binaryIds = new Map<string, number>();
  let strings = 0, binaryBytes = 0;
  function countString(value: string) {
    if (value.length > WORKSPACE_LIMITS.headerBytes) throw Error("Workspace text size limit exceeded.");
    strings += new TextEncoder().encode(value).length;
    if (strings > WORKSPACE_LIMITS.headerBytes) throw Error("Workspace text size limit exceeded.");
  }
  async function binary(blob: Blob) {
    if (blob.size > WORKSPACE_LIMITS.bytes) throw Error("Workspace binary size limit exceeded.");
    const sha256 = await hashBlob(blob), key = `${blob.size}:${sha256}`;
    const old = binaryIds.get(key); if (old !== undefined) return old;
    binaryBytes += blob.size;
    if (binaries.length >= WORKSPACE_LIMITS.binaries || binaryBytes > WORKSPACE_LIMITS.bytes) throw Error("Workspace binary size limit exceeded.");
    const id = binaries.length; binaries.push({ bytes: blob.size, sha256 }); parts.push(blob); binaryIds.set(key, id); return id;
  }
  async function visit(value: unknown, depth: number): Promise<Value> {
    if (depth > WORKSPACE_LIMITS.depth) throw Error("Workspace nesting limit exceeded.");
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") { countString(value); return value; }
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value !== undefined && typeof value !== "object") throw Error("Unsupported nonserializable workspace value.");
    if (value && active.has(value)) throw Error("Unsupported cyclic workspace data.");
    if (value && seen.has(value)) return { ref: seen.get(value)! };
    if (nodes.length >= WORKSPACE_LIMITS.nodes) throw Error("Workspace node limit exceeded.");
    const id = nodes.length, node: Node = { kind: "undefined" }; nodes.push(node);
    if (value === undefined) return { ref: id };
    seen.set(value as object, id); active.add(value as object);
    if (value instanceof Blob) {
      node.kind = typeof File !== "undefined" && value instanceof File ? "file" : "blob";
      node.binary = await binary(value); node.type = value.type;
      if (node.kind === "file") { node.name = (value as File).name; node.modified = (value as File).lastModified; }
    } else if (value instanceof ArrayBuffer || value instanceof Uint8Array) {
      node.kind = value instanceof ArrayBuffer ? "buffer" : "bytes";
      node.binary = await binary(new Blob([value instanceof ArrayBuffer ? value.slice(0) : Uint8Array.from(value)]));
    } else if (value instanceof Date) {
      if (!Number.isFinite(value.getTime())) throw Error("Unsupported workspace date.");
      node.kind = "date"; node.value = value.toISOString();
    } else if (Array.isArray(value) || value instanceof Set) {
      node.kind = Array.isArray(value) ? "array" : "set";
      const entries: Value[] = []; node.value = entries;
      for (const entry of value) entries.push(await visit(entry, depth + 1));
    } else if (value instanceof Map) {
      node.kind = "map"; const entries: [Value, Value][] = []; node.value = entries;
      for (const [key, entry] of value) entries.push([await visit(key, depth + 1), await visit(entry, depth + 1)]);
    } else {
      if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error("Unsupported nonserializable workspace object.");
      node.kind = "object"; const entries: [string, Value][] = []; node.value = entries;
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        keyValid(key); if (!descriptor.enumerable) continue;
        if (!Object.hasOwn(descriptor, "value")) throw Error("Unsupported workspace accessor.");
        countString(key); entries.push([key, await visit(descriptor.value, depth + 1)]);
      }
    }
    active.delete(value as object); return { ref: id };
  }
  const root = await visit(sections, 0);
  const payload: Payload = { kind: "reword-nerd-workspace", version: 1, root, nodes, binaries };
  const payloadText = JSON.stringify(payload), sha256 = await workspaceHash(new TextEncoder().encode(payloadText).buffer);
  const header = new TextEncoder().encode(JSON.stringify({ payload, sha256 }));
  if (header.length > WORKSPACE_LIMITS.headerBytes || 12 + header.length + binaryBytes > WORKSPACE_LIMITS.bytes) throw Error("Workspace save exceeds the 512 MiB recovery limit. Export smaller workspaces; the previous save is unchanged.");
  const size = new Uint8Array(4); new DataView(size.buffer).setUint32(0, header.length);
  return new Blob([MAGIC, size, header, ...parts], { type: "application/x-reword-nerd-workspace" });
}

/** Validate the complete inventory before returning any reconstructed section. */
export async function decodeWorkspace(file: Blob): Promise<Record<string, unknown>> {
  if (file.size < 12 || file.size > WORKSPACE_LIMITS.bytes) throw Error("Invalid workspace file size.");
  const prefix = new Uint8Array(await blobBytes(file.slice(0, 12)));
  if (!MAGIC.every((n, i) => prefix[i] === n)) throw Error("Unsupported workspace file or version.");
  const length = new DataView(prefix.buffer).getUint32(8);
  if (length > WORKSPACE_LIMITS.headerBytes || 12 + length > file.size) throw Error("Truncated or oversized workspace header.");
  const envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await blobBytes(file.slice(12, 12 + length))));
  const p = envelope?.payload as Payload;
  if (!p || p.kind !== "reword-nerd-workspace" || p.version !== 1 || !Array.isArray(p.nodes) || !Array.isArray(p.binaries) || p.nodes.length > WORKSPACE_LIMITS.nodes || p.binaries.length > WORKSPACE_LIMITS.binaries) throw Error("Unsupported workspace schema or limits.");
  if (await workspaceHash(new TextEncoder().encode(JSON.stringify(p)).buffer) !== envelope.sha256) throw Error("Workspace header integrity checksum mismatch.");
  const binaries: Blob[] = []; let offset = 12 + length;
  for (const b of p.binaries) {
    if (!b || !Number.isSafeInteger(b.bytes) || b.bytes < 0 || !/^[a-f0-9]{64}$/.test(b.sha256) || offset + b.bytes > file.size) throw Error("Invalid workspace binary inventory.");
    const blob = file.slice(offset, offset + b.bytes);
    if (await hashBlob(blob) !== b.sha256) throw Error("Workspace binary integrity checksum mismatch.");
    binaries.push(blob); offset += b.bytes;
  }
  if (offset !== file.size) throw Error("Unexpected workspace bytes outside the inventory.");
  const decoded: unknown[] = [];
  for (const n of p.nodes) {
    if (!n || typeof n.kind !== "string") throw Error("Invalid workspace graph node.");
    if (["blob", "file", "bytes", "buffer"].includes(n.kind)) {
      if (!Number.isInteger(n.binary) || n.binary! < 0 || n.binary! >= binaries.length) throw Error("Invalid workspace binary reference.");
      const blob = binaries[n.binary!];
      if (n.kind === "file") {
        if (typeof n.name !== "string" || n.name.length > 4096 || typeof n.type !== "string" || n.type.length > 256 || !Number.isFinite(n.modified)) throw Error("Invalid restored File metadata.");
        decoded.push(new File([blob], n.name, { type: n.type, lastModified: n.modified }));
      } else if (n.kind === "blob") {
        if (typeof n.type !== "string" || n.type.length > 256) throw Error("Invalid restored Blob metadata.");
        decoded.push(new Blob([blob], { type: n.type }));
      } else {
        const bytes = await blobBytes(blob); decoded.push(n.kind === "buffer" ? bytes : new Uint8Array(bytes));
      }
    } else if (["array", "object", "map", "set"].includes(n.kind)) {
      if (!Array.isArray(n.value)) throw Error("Invalid workspace graph entries.");
      decoded.push(n.kind === "array" ? [] : n.kind === "object" ? {} : n.kind === "map" ? new Map() : new Set());
    } else if (n.kind === "undefined") decoded.push(undefined);
    else if (n.kind === "date" && typeof n.value === "string" && Number.isFinite(Date.parse(n.value))) decoded.push(new Date(n.value));
    else throw Error("Unsupported workspace node type.");
  }
  function value(v: Value): unknown {
    if (v === null || typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) return v;
    if (!v || typeof v !== "object" || Object.keys(v).join(",") !== "ref" || !Number.isInteger(v.ref) || v.ref < 0 || v.ref >= decoded.length) throw Error("Invalid workspace graph reference.");
    return decoded[v.ref];
  }
  for (const [i, n] of p.nodes.entries()) {
    if (["object", "map"].includes(n.kind)) {
      const seen = new Set<unknown>();
      for (const pair of n.value as unknown[]) {
        if (!Array.isArray(pair) || pair.length !== 2) throw Error("Invalid workspace entry pair.");
        const key = n.kind === "object" ? pair[0] : value(pair[0]);
        if (n.kind === "object") keyValid(key);
        if (seen.has(key)) throw Error("Duplicate workspace entry."); seen.add(key);
        if (n.kind === "object") (decoded[i] as Record<string, unknown>)[key as string] = value(pair[1]);
        else (decoded[i] as Map<unknown, unknown>).set(key, value(pair[1]));
      }
    } else if (n.kind === "array") for (const item of n.value as Value[]) (decoded[i] as unknown[]).push(value(item));
    else if (n.kind === "set") for (const item of n.value as Value[]) (decoded[i] as Set<unknown>).add(value(item));
  }
  const visiting = new Set<number>(), heights = new Map<number, number>();
  function height(v: Value): number {
    if (!v || typeof v !== "object") return 0;
    value(v); if (visiting.has(v.ref)) throw Error("Unsupported cyclic workspace graph.");
    if (heights.has(v.ref)) return heights.get(v.ref)!;
    visiting.add(v.ref); const node = p.nodes[v.ref];
    const children: Value[] = node.kind === "object" ? (node.value as [string, Value][]).map(pair => pair[1]) : node.kind === "map" ? (node.value as [Value, Value][]).flat() : ["array", "set"].includes(node.kind) ? node.value as Value[] : [];
    let longest = 1;
    for (const child of children) { longest = Math.max(longest, 1 + height(child)); if (longest > WORKSPACE_LIMITS.depth) throw Error("Workspace nesting limit exceeded."); }
    visiting.delete(v.ref); heights.set(v.ref, longest); return longest;
  }
  height(p.root);
  const sections = value(p.root); sectionsValid(sections); return sections;
}
