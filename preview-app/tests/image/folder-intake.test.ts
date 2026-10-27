import { intakeImageFolder } from "../../src/image/intake";
import type { ImagePdfAdapter, ImagePdfPage } from "../../src/image/pdfIntake";
import type { ImageInputFile } from "../../src/image/intakeContracts";

const HASH = "a".repeat(64);
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const PDF = new TextEncoder().encode("%PDF-1.7\nfixture");
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1]);

interface TestFile extends ImageInputFile {
  readonly reads: () => number;
}

function file(
  name: string,
  relativePath: string,
  bytes: Uint8Array,
  type: string,
  declaredSize = bytes.byteLength,
): TestFile {
  let readCount = 0;
  return {
    name,
    type,
    size: declaredSize,
    webkitRelativePath: relativePath,
    reads: () => readCount,
    arrayBuffer: async () => {
      readCount += 1;
      return bytes.slice().buffer;
    },
  };
}

function pdfAdapter(options: { malformed?: boolean } = {}): ImagePdfAdapter {
  const page: ImagePdfPage = {
    async *enumerateEmbeddedRasters() {
      yield {
        width: 32,
        height: 24,
        readPng: async () => PNG.slice(),
        close: () => undefined,
      };
    },
    renderCapturePng: async () => ({ bytes: PNG.slice(), width: 32, height: 24 }),
    cleanup: () => undefined,
  };
  return {
    load: () => ({
      promise: options.malformed
        ? Promise.reject(new Error("private parser detail"))
        : Promise.resolve({ numPages: 1, getPage: async () => page, destroy: () => undefined }),
      destroy: () => undefined,
    }),
  };
}

const decoder = {
  decode: async () => ({ width: 32, height: 24, close: () => undefined }),
};

describe("browser folder Image intake", () => {
  it("sorts mixed safe paths, retains duplicate occurrences, and composes folder to PDF provenance", async () => {
    // Catches hash-based deduplication and flattened provenance when a folder contains a document.
    const result = await intakeImageFolder([
      file("z.png", "Album/z.png", PNG, "image/png"),
      file("photo.png", "Album/sub/photo.png", PNG, "image/png"),
      file("visuals.pdf", "Album/a/visuals.pdf", PDF, "application/pdf"),
    ], { decoder, hash: async () => HASH, pdfAdapter: pdfAdapter() });

    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.map(({ inputPath }) => inputPath)).toEqual([
      "a/visuals.pdf",
      "sub/photo.png",
      "z.png",
    ]);
    expect(result.candidates[0].candidate.provenance.containerChain).toEqual([
      { kind: "folder", name: "Album", sha256: null, path: null, byteCount: null },
      { kind: "pdf", name: "visuals.pdf", sha256: HASH, path: "a/visuals.pdf", byteCount: PDF.byteLength },
    ]);
    expect(result.candidates.slice(1).map(({ candidate }) => candidate.sourceHash)).toEqual([HASH, HASH]);
    expect(result.warnings.join(" ")).toMatch(/cannot independently verify.*symlink/i);
  });

  it("rejects an unsafe or portable-colliding folder atomically before reading any file", async () => {
    // Catches collision checks performed only after one sibling has already been admitted.
    const left = file("a.png", "Album/A.png", PNG, "image/png");
    const right = file("a.png", "Album/a.png", PNG, "image/png");
    await expect(intakeImageFolder([left, right], { decoder, hash: async () => HASH }))
      .rejects.toMatchObject({ issue: { code: "PATH_COLLISION" } });
    expect([left.reads(), right.reads()]).toEqual([0, 0]);
  });

  it("keeps safe siblings when an inner PDF is structurally invalid", async () => {
    // Catches accidental rollback of an entire browser folder for one malformed inner document.
    const result = await intakeImageFolder([
      file("broken.pdf", "Album/broken.pdf", PDF, "application/pdf"),
      file("safe.png", "Album/safe.png", PNG, "image/png"),
    ], { decoder, hash: async () => HASH, pdfAdapter: pdfAdapter({ malformed: true }) });
    expect(result.candidates.map(({ inputPath }) => inputPath)).toEqual(["safe.png"]);
    expect(result.rejections).toEqual([expect.objectContaining({
      inputPath: "broken.pdf",
      issue: expect.objectContaining({ code: "MALFORMED_PDF" }),
    })]);
    expect(result.rejections[0].issue.message).not.toContain("private parser detail");
  });

  it("checks each child size and unsupported/nested type before reading while preserving safe siblings", async () => {
    // Catches oversized or nested inputs reaching arrayBuffer and aborting unrelated folder members.
    const oversized = file("huge.png", "Album/huge.png", PNG, "image/png", 20 * 1024 * 1024 + 1);
    const nested = file("nested.zip", "Album/nested.zip", ZIP, "application/zip");
    const remote = file("remote.html", "Album/remote.html", new TextEncoder().encode("<img src=https://x>"), "text/html");
    const safe = file("safe.png", "Album/safe.png", PNG, "image/png");
    const result = await intakeImageFolder([oversized, nested, remote, safe], {
      decoder,
      hash: async () => HASH,
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.rejections.map(({ issue }) => issue.code)).toEqual([
      "INPUT_SIZE_INVALID",
      "NESTED_ARCHIVE",
      "REMOTE_DOCUMENT_UNSUPPORTED",
    ]);
    expect([oversized.reads(), nested.reads(), remote.reads()]).toEqual([0, 0, 0]);
    expect(safe.reads()).toBe(1);
  });

  it("owns admitted child bytes rather than retaining a mutable input view", async () => {
    const mutable = PNG.slice();
    const selected = file("safe.png", "Album/safe.png", mutable, "image/png");
    const result = await intakeImageFolder([selected], { decoder, hash: async () => HASH });
    mutable.fill(0);
    expect(new Uint8Array(await result.candidates[0].candidate.sourceBytes.arrayBuffer()))
      .toEqual(PNG);
    expect(result.candidates[0].candidate.sourceBytes).toMatchObject({
      size: PNG.byteLength,
      type: "image/png",
    });
  });
});
