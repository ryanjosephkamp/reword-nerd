// @vitest-environment node
import { describe, expect, it } from "vitest";
import { encodeWorkspace, decodeWorkspace } from "../../src/workspace/codec";

describe("portable workspace custody", () => {
  it("recovers exact original bytes, Unicode paths, reviewed text, and shared graph identities", async () => {
    const bytes = new Uint8Array([0, 255, 99, 97, 66, 88, 13, 10]);
    const original = new File([bytes], "café 雪.png", { type: "image/png", lastModified: 1234 });
    const document = { id: "doc-1", original, reviewedText: "雪\r\n[INSERT REWRITE OUTPUT HERE]  \n" };
    const sections = { studio: { documents: [document], selected: document, responses: new Map([["final", "Exact\r\n"]]), revisit: new Set(["rewrite"]), asset: bytes, raw: bytes.buffer, empty: undefined, optional: null } };
    const saved = await encodeWorkspace(sections);
    const restored = await decodeWorkspace(saved) as typeof sections;
    expect(restored.studio.documents[0]).toBe(restored.studio.selected);
    const file = restored.studio.selected.original;
    expect(file).toBeInstanceOf(File);
    expect([file.name, file.type, file.lastModified]).toEqual([original.name, original.type, 1234]);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
    expect(restored.studio.asset).toEqual(bytes);
    expect(new Uint8Array(restored.studio.raw)).toEqual(bytes);
    expect(restored.studio.responses.get("final")).toBe("Exact\r\n");
    expect(restored.studio.revisit.has("rewrite")).toBe(true);
    expect(restored.studio.selected.reviewedText).toBe(document.reviewedText);
    expect(Object.hasOwn(restored.studio, "empty")).toBe(true);
    expect(restored.studio.empty).toBeUndefined();
  });

  it("detects changed binary bytes before exposing any recovered section", async () => {
    const saved = await encodeWorkspace({ images: { original: new Blob(["owned bytes"]) } });
    const bytes = new Uint8Array(await saved.arrayBuffer());
    bytes[bytes.length - 1] ^= 1;
    await expect(decodeWorkspace(new Blob([bytes]))).rejects.toThrow(/integrity|checksum/i);
  });

  it("rejects truncated or unrelated files without accepting partial state", async () => {
    const saved = await encodeWorkspace({ studio: { text: "original" } });
    await expect(decodeWorkspace(saved.slice(0, 11))).rejects.toThrow();
    await expect(decodeWorkspace(new Blob(["<script>hostile data</script>"]))).rejects.toThrow();
  });

  it("rejects executable handles and prototype keys instead of losing them silently", async () => {
    await expect(encodeWorkspace({ studio: { run: () => undefined } })).rejects.toThrow(/unsupported|serializ/i);
    await expect(encodeWorkspace({ studio: { controller: new AbortController() } })).rejects.toThrow(/unsupported|serializ/i);
    await expect(encodeWorkspace({ studio: JSON.parse('{"__proto__":{"polluted":true}}') })).rejects.toThrow(/unsafe|prototype/i);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("rejects unknown sections and oversized graph strings before replacing a saved copy", async () => {
    await expect(encodeWorkspace({ credentials: { token: "synthetic" } })).rejects.toThrow(/section/i);
    await expect(encodeWorkspace({ studio: { text: "x".repeat(33 * 1024 * 1024) } })).rejects.toThrow(/limit|large|size/i);
  });

  it("preserves duplicate source bytes as separately named Files", async () => {
    const saved = await encodeWorkspace({ studio: { originals: [new File(["same"], "one.md"), new File(["same"], "two.md")] } });
    const value = await decodeWorkspace(saved) as { studio: { originals: File[] } };
    expect(value.studio.originals.map(f => f.name)).toEqual(["one.md", "two.md"]);
    expect(value.studio.originals[0]).not.toBe(value.studio.originals[1]);
  });
});

it("retains Unicode workbook identities in section names", async () => {
  const original = { "package:café-雪:progress": { text: "Exact" } };
  expect(await decodeWorkspace(await encodeWorkspace(original))).toEqual(original);
});

it("rejects cyclic data before replacing a good save", async () => {
  const cycle: { self?: unknown } = {}; cycle.self = cycle;
  await expect(encodeWorkspace({ studio: cycle })).rejects.toThrow(/cyclic|cycle|unsupported/i);
});


it("accepts the exact binary-record limit and rejects one additional distinct record", async () => {
  const binaries = Array.from({ length: 4097 }, (_, i) => { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, i); return new Blob([bytes]); });
  const exact = await encodeWorkspace({ images: { binaries: binaries.slice(0, 4096) } });
  const restored = await decodeWorkspace(exact) as { images: { binaries: Blob[] } };
  expect(restored.images.binaries).toHaveLength(4096);
  await expect(encodeWorkspace({ images: { binaries } })).rejects.toThrow(/binary.*limit/i);
}, 15_000);
