import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { ImagePackageManifestV1 } from "../src/image/export";
import { createImageFixture, IMAGE_FIXTURE_NOTICE, IMAGE_FIXTURE_OCR } from "./fixtures";

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function decodeFixture(bytes: Uint8Array) {
  const source = Buffer.from(bytes);
  expect([...source.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const width = source.readUInt32BE(16), height = source.readUInt32BE(20), depth = source[24], color = source[25];
  expect({ width, height, depth }).toEqual({ width: 320, height: 200, depth: 8 });
  const compressed: Buffer[] = [], chunks: string[] = [];
  for (let offset = 8; offset < source.length;) {
    const size = source.readUInt32BE(offset), type = source.toString("ascii", offset + 4, offset + 8);
    chunks.push(type);
    if (type === "IDAT") compressed.push(source.subarray(offset + 8, offset + 8 + size));
    offset += size + 12;
    expect(offset).toBeLessThanOrEqual(source.length);
  }
  expect(chunks).toEqual(["IHDR", "IDAT", "IEND"]);
  const channels = color === 2 ? 3 : 4;
  const scanlines = inflateSync(Buffer.concat(compressed));
  expect(scanlines.length).toBe((width * channels + 1) * height);
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    const row = y * (width * channels + 1);
    expect(scanlines[row]).toBe(0);
    for (let x = 0; x < width; x++) {
      const offset = row + 1 + x * channels;
      scanlines.copy(rgb, (y * width + x) * 3, offset, offset + 3);
      if (channels === 4) expect(scanlines[offset + 3]).toBe(255);
    }
  }
  return { color, rgb };
}

describe("owned no-model image fixtures", () => {
  it("produces reproducible RGB references and visibly different opaque RGBA results", async () => {
    const first = await createImageFixture(), second = await createImageFixture();
    expect(first).toEqual(second);
    const reference = decodeFixture(first.referenceBytes), result = decodeFixture(first.resultBytes);
    expect([reference.color, result.color]).toEqual([2, 6]);
    let changed = 0;
    for (let offset = 0; offset < reference.rgb.length; offset += 3) {
      if (!reference.rgb.subarray(offset, offset + 3).equals(result.rgb.subarray(offset, offset + 3))) changed++;
    }
    expect(changed / (320 * 200)).toBeGreaterThan(0.8);
  });

  it("uses the production schema-1 tree and preserves source bytes and all artifact hashes", async () => {
    const fixture = await createImageFixture();
    const zip = await JSZip.loadAsync(fixture.packageBytes, { checkCRC32: true });
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string")) as ImagePackageManifestV1;
    expect(manifest).toMatchObject({ schemaVersion: 1, package: { format: "image-reference-prompt-package", pairCount: 1 } });
    const pair = manifest.pairs[0];
    expect(pair.source).toMatchObject({ mediaType: "image/png", width: 320, height: 200, sha256: digest(fixture.referenceBytes) });
    expect(pair.warnings).toContain(IMAGE_FIXTURE_NOTICE);
    expect(pair.ocr).toEqual({ accepted: false, acceptedTextSha256: null, acceptedCodePoints: null });
    expect(await zip.file(pair.source.path)!.async("uint8array")).toEqual(fixture.referenceBytes);
    const paths = Object.values(zip.files).filter(entry => !entry.dir).map(entry => entry.name).sort();
    expect(paths).toHaveLength(9);
    expect(manifest.artifactInventory.map(artifact => artifact.path)).toEqual(paths.filter(path => path !== "manifest.json"));
    for (const artifact of manifest.artifactInventory) {
      const bytes = await zip.file(artifact.path)!.async("uint8array");
      expect(artifact.sha256).toBe(digest(bytes));
      expect(artifact.byteCount).toBe(bytes.length);
    }
    expect(await zip.file(pair.artifacts.prompt.path)!.async("string")).toContain("Preserve the visible NO MODEL label.");
    expect(paths.some(path => path.includes("result"))).toBe(false);
  });

  it("offers an explicit accepted-OCR boundary fixture with exact Unicode text binding", async () => {
    const fixture = await createImageFixture({ acceptedOcr: true });
    const zip = await JSZip.loadAsync(fixture.packageBytes, { checkCRC32: true });
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string")) as ImagePackageManifestV1;
    const pair = manifest.pairs[0];
    expect(pair.ocr).toEqual({ accepted: true, acceptedTextSha256: digest(new TextEncoder().encode(IMAGE_FIXTURE_OCR)), acceptedCodePoints: [...IMAGE_FIXTURE_OCR].length });
    expect(await zip.file(pair.artifacts.prompt.path)!.async("string")).toContain(JSON.stringify(IMAGE_FIXTURE_OCR));
  });
});
