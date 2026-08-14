import {
  createImageIntakeService,
  type ImageIntakeService,
} from "../../src/image/intake";
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import {
  MAX_IMAGE_SESSION_BYTES,
  type ImageAdmission,
  type ImageInputFile,
} from "../../src/image/intakeContracts";
import type { ArchiveEntryAdapter, ArchiveReaderAdapter } from "../../src/image/safeArchive";
import type { ImagePdfAdapter, ImagePdfPage } from "../../src/image/pdfIntake";
import type { DocxConverterAdapter } from "../../src/image/docxIntake";

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const GIF = new TextEncoder().encode("GIF89a");
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1]);
const HASH = "b".repeat(64);

function file(name: string, bytes: Uint8Array, type = ""): ImageInputFile {
  return {
    name,
    type,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.slice().buffer,
  };
}

function folderFile(name: string, path: string, bytes: Uint8Array, type = ""): ImageInputFile {
  return { ...file(name, bytes, type), webkitRelativePath: path };
}

function archiveEntry(path: string, bytes: Uint8Array): ArchiveEntryAdapter {
  return {
    path,
    directory: false,
    encrypted: false,
    compressedSize: Math.max(1, bytes.byteLength),
    uncompressedSize: bytes.byteLength,
    unixMode: 0o100644,
    read: async (writable) => {
      const writer = writable.getWriter();
      await writer.write(bytes.slice());
      await writer.close();
    },
  };
}

function archiveReader(entries: readonly ArchiveEntryAdapter[]): ArchiveReaderAdapter {
  return {
    async *entries() { for (const entry of entries) yield entry; },
    close: async () => undefined,
  };
}

async function compactDocxBytes(): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  const xml = new TextEncoder();
  await writer.add("[Content_Types].xml", new Uint8ArrayReader(xml.encode("<Types/>")));
  await writer.add("_rels/.rels", new Uint8ArrayReader(xml.encode("<Relationships/>")));
  await writer.add("word/document.xml", new Uint8ArrayReader(xml.encode("<w:document/>")));
  return writer.close();
}

async function zipWith(path: string, bytes: Uint8Array): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add(path, new Uint8ArrayReader(bytes));
  return writer.close();
}

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function harness(overrides: {
  decoder?: { decode(source: Blob, signal?: AbortSignal): Promise<{ width: number; height: number; close(): void }> };
  archiveOpen?: (source: Blob) => Promise<ArchiveReaderAdapter>;
  docxArchiveOpen?: (source: Blob) => Promise<ArchiveReaderAdapter>;
  docxConverter?: DocxConverterAdapter;
  pdfAdapter?: ImagePdfAdapter;
  resolvePdfCapture?: Parameters<typeof createImageIntakeService>[0]["resolvePdfCapture"];
} = {}) {
  const authoritative: ImageAdmission[] = [];
  let nextId = 1;
  const service: ImageIntakeService = createImageIntakeService({
    decoder: overrides.decoder ?? {
      decode: async () => ({ width: 40, height: 30, close: () => undefined }),
    },
    hash: async () => HASH,
    idFactory: () => `occ-${nextId++}`,
    archiveOpen: overrides.archiveOpen,
    docxArchiveOpen: overrides.docxArchiveOpen,
    docxConverter: overrides.docxConverter,
    pdfAdapter: overrides.pdfAdapter,
    resolvePdfCapture: overrides.resolvePdfCapture,
    publish: (admission, sessionEpoch) => {
      authoritative.push(admission);
      service.reconcile(authoritative);
      return { accepted: true, occurrenceId: admission.id, sessionEpoch };
    },
  });
  return { service, authoritative };
}

describe("Image intake integration", () => {
  it("admits a mixed top-level batch with an exact partial ledger and ZIP provenance", async () => {
    // Catches top-level all-or-nothing rollback, silent unsupported entries, and flattened ZIP custody.
    const reader = archiveReader([
      archiveEntry("b/unsupported.gif", GIF),
      archiveEntry("a/source.png", PNG),
    ]);
    const { service, authoritative } = harness({ archiveOpen: async () => reader });
    const result = await service.intake([
      file("direct.png", PNG, "image/png"),
      file("unsupported.gif", GIF, "image/gif"),
      file("bundle.zip", ZIP, "application/zip"),
    ]);

    expect(result.admissions.map(({ id }) => id)).toEqual(["occ-1", "occ-2"]);
    expect(result.ledger).toEqual([
      { inputName: "direct.png", path: null, status: "accepted", occurrenceId: "occ-1", issue: null },
      expect.objectContaining({ inputName: "unsupported.gif", path: null, status: "rejected", occurrenceId: null, issue: expect.objectContaining({ code: "UNSUPPORTED_FORMAT" }) }),
      { inputName: "bundle.zip", path: "a/source.png", status: "accepted", occurrenceId: "occ-2", issue: null },
      expect.objectContaining({ inputName: "bundle.zip", path: "b/unsupported.gif", status: "rejected", occurrenceId: null, issue: expect.objectContaining({ code: "UNSUPPORTED_FORMAT" }) }),
    ]);
    expect(authoritative[1].provenance).toMatchObject({
      intakeKind: "zip",
      sourcePath: "a/source.png",
      containerChain: [{ kind: "zip", name: "bundle.zip", sha256: HASH, path: null, byteCount: ZIP.byteLength }],
    });
    expect(authoritative.every(({ sourceBytes }) => sourceBytes.size === PNG.byteLength)).toBe(true);
  });

  it("rejects a structurally ambiguous ZIP atomically before publishing safe siblings inside it", async () => {
    // Catches entry-by-entry publication before the complete ZIP directory/body audit succeeds.
    const reader = archiveReader([
      archiveEntry("safe.png", PNG),
      archiveEntry("nested.zip", ZIP),
    ]);
    const { service, authoritative } = harness({ archiveOpen: async () => reader });
    const result = await service.intake([file("bundle.zip", ZIP, "application/zip")]);
    expect(result.admissions).toEqual([]);
    expect(authoritative).toEqual([]);
    expect(result.ledger).toEqual([expect.objectContaining({
      inputName: "bundle.zip",
      path: null,
      status: "rejected",
      issue: expect.objectContaining({ code: "NESTED_ARCHIVE" }),
    })]);
  });

  it("accepts a structurally audited DOCX inside a ZIP and preserves the full container chain", async () => {
    const docx = await compactDocxBytes();
    const outerZip = await zipWith("docs/image-only.docx", docx);
    const converter: DocxConverterAdapter = {
      convertToHtml: async (_input, converterOptions) => {
        await converterOptions.convertImage({ contentType: "image/png", read: async () => base64(PNG) });
        return { value: "<img>", messages: [] };
      },
    };
    const { service } = harness({
      docxConverter: converter,
    });
    const result = await service.intake([file("bundle.zip", outerZip, "application/zip")]);
    expect(result.admissions).toHaveLength(1);
    expect(result.admissions[0].provenance.containerChain).toEqual([
      { kind: "zip", name: "bundle.zip", sha256: HASH, path: null, byteCount: outerZip.byteLength },
      { kind: "docx", name: "image-only.docx", sha256: HASH, path: "docs/image-only.docx", byteCount: docx.byteLength },
    ]);
    expect(result.ledger).toEqual([
      { inputName: "bundle.zip", path: "docs/image-only.docx", status: "accepted", occurrenceId: "occ-1", issue: null },
    ]);
  });

  it("enforces authoritative cumulative count and bytes without phantom IDs or ordinals", async () => {
    // Catches admission code that ignores already-retained source custody.
    const { service } = harness();
    service.reconcile([{ id: "existing", sourceBytes: { size: MAX_IMAGE_SESSION_BYTES - 4 } as Blob }]);
    const rejected = await service.intake([file("over.png", PNG, "image/png")]);
    expect(rejected.admissions).toEqual([]);
    expect(rejected.ledger[0]).toMatchObject({ issue: { code: "SESSION_BYTES_EXCEEDED" } });

    service.reconcile([]);
    const accepted = await service.intake([file("after.png", PNG, "image/png")]);
    expect(accepted.admissions[0]).toMatchObject({ id: "occ-1", ordinal: 0 });
  });

  it("reserves an extracted document image before decode and hash", async () => {
    // Catches PDF/DOCX candidates doing expensive decode work before the authoritative session cap check.
    let decodes = 0;
    const rasterPage: ImagePdfPage = {
      enumerateEmbeddedRasters: async () => [{
        width: 40,
        height: 30,
        readPng: async () => PNG.slice(),
        close: () => undefined,
      }],
      renderCapturePng: async () => ({ bytes: PNG.slice(), width: 40, height: 30 }),
      cleanup: () => undefined,
    };
    const pdfAdapter: ImagePdfAdapter = {
      load: () => ({
        promise: Promise.resolve({ numPages: 1, getPage: async () => rasterPage, destroy: () => undefined }),
        destroy: () => undefined,
      }),
    };
    const { service } = harness({
      pdfAdapter,
      decoder: {
        decode: async () => {
          decodes += 1;
          return { width: 40, height: 30, close: () => undefined };
        },
      },
    });
    service.reconcile([{ id: "existing", sourceBytes: { size: MAX_IMAGE_SESSION_BYTES - 4 } as Blob }]);
    const result = await service.intake([file("visuals.pdf", new TextEncoder().encode("%PDF-1.7\nfixture"), "application/pdf")]);
    expect(decodes).toBe(0);
    expect(result.admissions).toEqual([]);
    expect(result.ledger).toEqual([expect.objectContaining({ issue: expect.objectContaining({ code: "SESSION_BYTES_EXCEEDED" }) })]);
  });

  it("serializes concurrent extraction operations", async () => {
    // Catches parallel image decodes that can multiply browser memory use.
    let active = 0;
    let maximum = 0;
    const { service } = harness({
      decoder: {
        decode: async () => {
          active += 1;
          maximum = Math.max(maximum, active);
          await Promise.resolve();
          active -= 1;
          return { width: 10, height: 10, close: () => undefined };
        },
      },
    });
    await Promise.all([
      service.intake([file("a.png", PNG, "image/png")]),
      service.intake([file("b.png", PNG, "image/png")]),
    ]);
    expect(maximum).toBe(1);
  });

  it("keeps the controller-owned folder ledger in deterministic path order", async () => {
    const { service } = harness();
    const result = await service.intakeFolder([
      folderFile("z.png", "Album/z.png", PNG, "image/png"),
      folderFile("a.gif", "Album/a.gif", GIF, "image/gif"),
    ]);
    expect(result.ledger.map(({ path, status }) => [path, status])).toEqual([
      ["a.gif", "rejected"],
      ["z.png", "accepted"],
    ]);
  });

  it("suppresses stale completion after reset and publishes no orphan", async () => {
    // Catches old-session decode/hash completion entering a newly reset portal.
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const { service, authoritative } = harness({
      decoder: {
        decode: async () => {
          await gate;
          return { width: 10, height: 10, close: () => undefined };
        },
      },
    });
    const pending = service.intake([file("old.png", PNG, "image/png")]);
    await Promise.resolve();
    service.reset();
    finish();
    await expect(pending).rejects.toMatchObject({ issue: { code: "STALE_SESSION" } });
    expect(authoritative).toEqual([]);
    expect(service.snapshot()).toEqual({ count: 0, bytes: 0, sessionEpoch: 1 });
  });

  it("owns nested PDF capture choice and canonicalizes selected pages before extraction", async () => {
    // Catches a UI republishing admissions or bypassing the controller for nested PDF page capture.
    const renders: Array<[number, number]> = [];
    const pdfAdapter: ImagePdfAdapter = {
      load: () => ({
        promise: Promise.resolve({
          numPages: 3,
          getPage: async (pageNumber): Promise<ImagePdfPage> => ({
            enumerateEmbeddedRasters: async () => [],
            renderCapturePng: async (scale) => {
              renders.push([pageNumber, scale]);
              return { bytes: PNG.slice(), width: 40, height: 30 };
            },
            cleanup: () => undefined,
          }),
          destroy: () => undefined,
        }),
        destroy: () => undefined,
      }),
    };
    const reader = archiveReader([archiveEntry("docs/visuals.pdf", new TextEncoder().encode("%PDF-1.7\nnested"))]);
    const contexts: Array<{ inputName: string; path: string | null; pageCount: number; aborted: boolean }> = [];
    const { service } = harness({
      archiveOpen: async () => reader,
      pdfAdapter,
      resolvePdfCapture: async (context) => {
        contexts.push({
          inputName: context.inputName,
          path: context.path,
          pageCount: context.pageCount,
          aborted: context.signal.aborted,
        });
        return { mode: "embedded-and-pages", pages: [3, 1, 3, 2], quality: "high" };
      },
    });
    const result = await service.intake([file("bundle.zip", ZIP, "application/zip")]);
    expect(contexts).toEqual([{ inputName: "bundle.zip", path: "docs/visuals.pdf", pageCount: 3, aborted: false }]);
    expect(renders).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(result.admissions).toHaveLength(3);
    expect(result.admissions.map(({ provenance }) => provenance.pageNumber)).toEqual([1, 2, 3]);
  });
});
