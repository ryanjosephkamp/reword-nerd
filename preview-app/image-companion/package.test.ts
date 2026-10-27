import {createPackageValidator} from "./portable/package";
import {nodeRuntime} from "./nodeRuntime";
import {browserRuntime} from "./portable/browser";
import { createHash } from "node:crypto";
import { crc32, deflateRawSync } from "node:zlib";
import JSZip from "jszip";
import { beforeAll, describe, expect, it } from "vitest";
import type { ImagePackageManifestV1 } from "../src/image/export/contracts";
import { createImageFixture } from "./fixtures";
import { IMAGE_LIMITS, ImagePackageValidationError } from "./package";

type Mutable<T> = { -readonly [P in keyof T]: Mutable<T[P]> };
type Manifest = Mutable<ImagePackageManifestV1>;
let fixture: Awaited<ReturnType<typeof createImageFixture>>;
beforeAll(async () => { fixture = await createImageFixture(); });
const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
async function mutate(change: (zip: JSZip, manifest: Manifest) => void | Promise<void>): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(fixture.packageBytes);
  const manifest = JSON.parse(await zip.file("manifest.json")!.async("string")) as Manifest;
  await change(zip, manifest);
  zip.file("manifest.json", JSON.stringify(manifest, null, 2) + "\n", { createFolders: false });
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", platform: "UNIX" });
}

interface RawEntry { name: string; data: Buffer; declaredSize?: number; suffix?: Buffer }
function rawZip(entries: RawEntry[], prefix = Buffer.alloc(0)): Buffer {
  const payloads = [prefix], records: Buffer[] = [];
  let offset = prefix.length;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), payload = Buffer.concat([deflateRawSync(entry.data), entry.suffix ?? Buffer.alloc(0)]);
    const local = Buffer.alloc(30), central = Buffer.alloc(46), checksum = crc32(entry.data);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14); local.writeUInt32LE(payload.length, 18); local.writeUInt32LE(entry.declaredSize ?? entry.data.length, 22); local.writeUInt16LE(name.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(checksum, 16); central.writeUInt32LE(payload.length, 20); central.writeUInt32LE(entry.declaredSize ?? entry.data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    payloads.push(local, name, payload); records.push(central, name);
    offset += local.length + name.length + payload.length;
  }
  const directory = Buffer.concat(records), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...payloads, directory, end]);
}
async function fixtureEntries(): Promise<RawEntry[]> {
  const zip = await JSZip.loadAsync(fixture.packageBytes);
  return Promise.all(Object.values(zip.files).filter(entry => !entry.dir).map(async entry => ({ name: entry.name, data: await entry.async("nodebuffer") })));
}

describe.each([["Node",nodeRuntime],["browser",browserRuntime]] as const)("%s package adapter",(_name,runtime)=>{
const {loadImagePackage}=createPackageValidator(runtime);
describe("canonical one-reference image packages", () => {
  it("loads production artifacts with exact source/prompt hashes and preserved settings", async () => {
    const loaded = await loadImagePackage(fixture.packageBytes);
    expect(loaded.referenceBytes).toEqual(fixture.referenceBytes);
    expect(loaded.packageSha256).toBe(hash(fixture.packageBytes));
    expect(loaded.referenceSha256).toBe(hash(fixture.referenceBytes));
    expect(loaded.promptSha256).toBe(hash(new TextEncoder().encode(loaded.prompt)));
    expect(loaded.prompt).toContain("Preserve the visible NO MODEL label.");
    expect(loaded.configuration).toEqual(loaded.manifest.pairs[0].configuration);
    expect(loaded.prompt.endsWith("\n")).toBe(true);
  });
  it("owns the returned source bytes rather than aliasing caller input", async () => {
    const input = Buffer.from(fixture.packageBytes), expected = Buffer.from(fixture.referenceBytes);
    const pending = loadImagePackage(input); input.fill(0);
    const result = await pending;
    expect(Buffer.from(result.referenceBytes)).toEqual(expected);
  });
  it("rejects accepted OCR because the package manifest cannot reconstruct its exact text", async () => {
    await expect(loadImagePackage((await createImageFixture({ acceptedOcr: true })).packageBytes)).rejects.toThrow(/OCR/u);
  });
  it.each(["schema", "multiple", "profile", "version", "source-name", "dimension", "key"])("rejects inconsistent %s identity", async kind => {
    const bytes = await mutate((_, manifest) => {
      if (kind === "schema") Object.assign(manifest, { schemaVersion: 2 });
      if (kind === "multiple") manifest.pairs.push(manifest.pairs[0]);
      if (kind === "profile") manifest.pairs[0].configuration.profile.id = "other-custom";
      if (kind === "version") manifest.pairs[0].configuration.profile.profileVersion = "unknown-future-version";
      if (kind === "source-name") manifest.pairs[0].displayName = "image.svg";
      if (kind === "dimension") manifest.pairs[0].source.width++;
      if (kind === "key") manifest.pairs[0].key = "001-unrelated";
    });
    await expect(loadImagePackage(bytes)).rejects.toThrow(ImagePackageValidationError);
  });
  it("rejects changed prompts even when every prompt hash is updated", async () => {
    const bytes = await mutate((zip, manifest) => {
      const record = manifest.pairs[0].artifacts.prompt, prompt = Buffer.from("Different instructions, unrelated to the reference.\n");
      zip.file(record.path, prompt, { createFolders: false });
      for (const candidate of [...manifest.artifactInventory, record]) if (candidate.path === record.path) { candidate.sha256 = hash(prompt); candidate.byteCount = prompt.length; }
    });
    await expect(loadImagePackage(bytes)).rejects.toThrow(/canonical/u);
  });
  it("rejects unlisted files, hash corruption, missing artifacts and duplicate inventory", async () => {
    const mutations = [
      (zip: JSZip) => { zip.file("hidden.txt", "hidden", { createFolders: false }); },
      (_: JSZip, manifest: Manifest) => { manifest.artifactInventory[0].sha256 = "0".repeat(64); },
      (zip: JSZip, manifest: Manifest) => { zip.remove(manifest.pairs[0].artifacts.runCard.path); },
      (_: JSZip, manifest: Manifest) => { manifest.artifactInventory.push(manifest.artifactInventory[0]); },
    ];
    for (const mutation of mutations) await expect(loadImagePackage(await mutate(mutation))).rejects.toThrow(ImagePackageValidationError);
  });
  it("rejects unsafe ZIP paths, encrypted flags, symlink attributes and declared size excess", async () => {
    const unsafe = await mutate(zip => { zip.file("../escape.txt", "hidden", { createFolders: false }); });
    await expect(loadImagePackage(unsafe)).rejects.toThrow(ImagePackageValidationError);
    for (const alteration of ["encrypted", "symlink", "size", "crc", "descriptor", "compression"]) {
      const bytes = Buffer.from(fixture.packageBytes), directory = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
      if (alteration === "encrypted") bytes.writeUInt16LE(bytes.readUInt16LE(directory + 8) | 1, directory + 8);
      if (alteration === "symlink") bytes.writeUInt32LE((0o120777 << 16) >>> 0, directory + 38);
      if (alteration === "size") bytes.writeUInt32LE(IMAGE_LIMITS.entryBytes + 1, directory + 24);
      if (alteration === "crc") bytes[directory + 16] ^= 1;
      if (alteration === "descriptor") bytes.writeUInt16LE(bytes.readUInt16LE(directory + 8) | 8, directory + 8);
      if (alteration === "compression") bytes.writeUInt16LE(12, directory + 10);
      await expect(loadImagePackage(bytes)).rejects.toThrow(ImagePackageValidationError);
    }
    await expect(loadImagePackage(new Uint8Array(IMAGE_LIMITS.archiveBytes + 1))).rejects.toThrow(/limit/u);
  });
  it("rejects alternate JSON serialization rather than hiding duplicate-key ambiguity", async () => {
    const zip = await JSZip.loadAsync(fixture.packageBytes);
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    zip.file("manifest.json", JSON.stringify(manifest), { createFolders: false });
    await expect(loadImagePackage(await zip.generateAsync({ type: "uint8array" }))).rejects.toThrow(/canonical/u);
  });
  it("accepts equivalent bounded ZIP compression and rejects actual duplicate names and case aliases", async () => {
    const entries = await fixtureEntries();
    await expect(loadImagePackage(rawZip(entries))).resolves.toMatchObject({ referenceSha256: hash(fixture.referenceBytes) });
    await expect(loadImagePackage(rawZip([...entries, entries[0]]))).rejects.toThrow(/duplicate/u);
    await expect(loadImagePackage(rawZip([...entries, { ...entries[0], name: entries[0].name.toLowerCase() }]))).rejects.toThrow(/duplicate|aliased/u);
  });
  it("rejects declared expanded totals before inflation and actual inflate exceeding declarations", async () => {
    const entries = await fixtureEntries();
    await expect(loadImagePackage(rawZip(entries.map((entry, index) => index < 3 ? { ...entry, declaredSize: 20 * 1024 * 1024 } : entry)))).rejects.toThrow(/expanded-byte/u);
    await expect(loadImagePackage(rawZip(entries.map((entry, index) => index === 0 ? { ...entry, declaredSize: 1 } : entry)))).rejects.toThrow(/expanded size/u);
  });
  it("rejects hidden compressed tails, prefixed containers, trailing data and ZIP64", async () => {
    const entries = await fixtureEntries();
    await expect(loadImagePackage(rawZip(entries.map((entry, index) => index === 0 ? { ...entry, suffix: Buffer.from("hidden compressed tail") } : entry)))).rejects.toThrow(ImagePackageValidationError);
    await expect(loadImagePackage(rawZip(entries, Buffer.from("prefix")))).rejects.toThrow(/hidden|prefixed/u);
    await expect(loadImagePackage(Buffer.concat([rawZip(entries), Buffer.from("tail")]))).rejects.toThrow(ImagePackageValidationError);
    const zip64 = rawZip(entries); zip64.writeUInt16LE(0xffff, zip64.length - 12);
    await expect(loadImagePackage(zip64)).rejects.toThrow(/ZIP64/u);
  });
});

});
