import { loadImagePackage, readArchive } from "../../image-companion/package";
import { prepareTextMember, freezeCollection, type CollectionEnvelope, type CollectionMember } from "../../src/collections/prepare";
import { base64, canonical, digest, fromWire, toWire, unbase64 } from "../../src/collections/codec";
import { boundedCount, collectionPath, uniquePaths, COLLECTION_LIMITS as L } from "../../src/collections/limits";
import type { ExportSourceInput } from "../../src/export";
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
export async function loadCollection(bytes: Uint8Array): Promise<{ envelope: CollectionEnvelope; seal: string }> {
  boundedCount(bytes.length, L.transportBytes, "Collection transport");
  const text = decoder.decode(bytes), raw = JSON.parse(text) as CollectionEnvelope;
  if (canonical(raw) !== text || raw.kind !== "reword-nerd-collection" || raw.schemaVersion !== 1 || !Array.isArray(raw.members)) throw Error("Noncanonical or unsupported collection envelope");
  boundedCount(raw.members.length, raw.operation === "image" ? L.imageMembers : L.textMembers, "Member count");
  let expanded = 0, entries = 0;
  const rebuilt: CollectionMember[] = [];
  for (const m of raw.members) {
    const pkg = unbase64(m.packageBase64, L.packageBytes);
    const files = readArchive(pkg, { archiveBytes: L.packageBytes, expandedBytes: L.expandedBytes, entryBytes: L.archiveEntryBytes, entries: L.archiveEntries }, path => { try { collectionPath(path); return true; } catch { return false; } });
    uniquePaths([...files.keys()]);
    expanded += [...files.values()].reduce((n, b) => n + b.length, 0); entries += files.size;
    boundedCount(expanded, L.expandedBytes, "Combined expanded archive bytes"); boundedCount(entries, L.archiveEntries, "Combined archive entries");
    let expected: CollectionMember;
    if (m.kind === "image") {
      // The unchanged entry point retains schema-1 PNG, dimensions/media and no-OCR restrictions.
      const image = await loadImagePackage(pkg);
      expected = { id: m.id, path: m.path, kind: "image", format: "png", packageBase64: base64(pkg), packageSha256: image.packageSha256, packageBytes: pkg.length, preparation: null,
        sourceManifest: await toWire(image.manifest.pairs[0].source), originalBytes: image.referenceBytes.length, reviewedBytes: 0, sourceSha256: image.referenceSha256,
        settings: await toWire(image.configuration.settings), settingsSha256: await digest(canonical(image.configuration.settings)), prompts: null, imagePrompt: image.prompt, promptSha256: image.promptSha256,
        expectedOutputs: [{ id: `${m.id}/rendition`, memberId: m.id, path: m.path, kind: "rendition", status: "missing" }], omissions: [] };
    } else {
      if (!m.preparation) throw Error("Missing public text preparation snapshot");
      const input = fromWire(m.preparation) as ExportSourceInput;
      expected = await prepareTextMember(m.id, m.path, input);
      const reconstructed = readArchive(unbase64(expected.packageBase64, L.packageBytes), { archiveBytes: L.packageBytes, expandedBytes: L.expandedBytes, entryBytes: L.archiveEntryBytes, entries: L.archiveEntries }, path => { try { collectionPath(path); return true; } catch { return false; } });
      if (canonical([...files.keys()].sort()) !== canonical([...reconstructed.keys()].sort())) throw Error("Package inventory differs from public preparation");
      for (const [path, data] of files) if (await digest(data) !== await digest(reconstructed.get(path)!)) throw Error("Package artifact binding mismatch: " + path);
      // Keep the exact submitted archive bytes; compression is not an execution identity.
      expected = { ...expected, packageBase64: base64(pkg), packageSha256: await digest(pkg), packageBytes: pkg.length };
    }
    if (canonical(m) !== canonical(expected)) throw Error("Member source, prompt, settings or output binding mismatch");
    rebuilt.push(expected);
  }
  const envelope = await freezeCollection(rebuilt, { id: raw.id, revision: raw.revision, sharedInstruction: raw.sharedInstruction, runtime: raw.runtime, resendOf: raw.resendOf });
  if (canonical(envelope) !== text) throw Error("Collection inventory or framing mismatch");
  return { envelope, seal: await digest(bytes) };
}
