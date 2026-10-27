import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { DEFAULT_IMAGE_PROMPT_SETTINGS } from "../src/image/contracts";
import { buildImagePromptPackage, type ImagePackageSnapshot } from "../src/image/export";
import { imagePromptProfile } from "../src/image/profiles";

export const IMAGE_FIXTURE_NOTICE = "NO MODEL: deterministic synthetic test artwork; no model was called.";
export const IMAGE_FIXTURE_OCR = "NO MODEL\nREFERENCE — café 🌿\n";
const WIDTH = 320;
const HEIGHT = 200;

const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
};

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const name = Buffer.from(type, "ascii");
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length, 0);
  name.copy(output, 4);
  output.set(data, 8);
  output.writeUInt32BE(crc32(output.subarray(4, 8 + data.length)), 8 + data.length);
  return output;
}

/** Owned pixels only. Neither this renderer nor its result is an image-model adapter. */
function syntheticPng(result: boolean): Uint8Array {
  const channels = result ? 4 : 3;
  const pixels = Buffer.alloc(WIDTH * HEIGHT * channels);
  const put = (x: number, y: number, color: readonly number[]) => {
    const offset = (y * WIDTH + x) * channels;
    pixels[offset] = color[0]; pixels[offset + 1] = color[1]; pixels[offset + 2] = color[2];
    if (channels === 4) pixels[offset + 3] = 255;
  };
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      let color = result ? [31, 40, 72] : [240, 236, 219];
      if (result ? x > 184 && x < 278 && y > 70 && y < 160 : (x - 100) ** 2 + (y - 115) ** 2 < 42 ** 2) {
        color = result ? [117, 212, 210] : [233, 167, 43];
      }
      if (y > 153 && y < 167 && x > 30 && x < 290) color = result ? [231, 111, 81] : [41, 89, 61];
      put(x, y, color);
    }
  }
  const label = (text: string, left: number, top: number, scale: number) => {
    for (const [index, character] of [...text].entries()) {
      const glyph = GLYPHS[character];
      if (!glyph) continue;
      glyph.forEach((row, y) => [...row].forEach((pixel, x) => {
        if (pixel !== "1") return;
        for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
          put(left + index * 6 * scale + x * scale + dx, top + y * scale + dy, result ? [247, 240, 226] : [31, 58, 49]);
        }
      }));
    }
  };
  label("NO MODEL", 25, 20, 3);
  label(result ? "RESULT" : "REFERENCE", 25, 177, 2);
  const scanlines = Buffer.alloc(HEIGHT * (WIDTH * channels + 1));
  for (let y = 0; y < HEIGHT; y++) pixels.copy(scanlines, y * (WIDTH * channels + 1) + 1, y * WIDTH * channels, (y + 1) * WIDTH * channels);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0); header.writeUInt32BE(HEIGHT, 4); header[8] = 8; header[9] = result ? 6 : 2;
  return Uint8Array.from(Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header), chunk("IDAT", deflateSync(scanlines, { level: 9 })), chunk("IEND", new Uint8Array()),
  ]));
}

export interface ImageFixture {
  readonly packageBytes: Uint8Array;
  readonly referenceBytes: Uint8Array;
  readonly resultBytes: Uint8Array;
}

/** Real schema-1 exporter output. acceptedOcr is an unsupported-input rejection fixture. */
export async function createImageFixture(options: { acceptedOcr?: boolean } = {}): Promise<ImageFixture> {
  const referenceBytes = syntheticPng(false);
  const resultBytes = syntheticPng(true);
  const sourceBytes = new Blob([Uint8Array.from(referenceBytes).buffer], { type: "image/png" });
  const sourceHash = createHash("sha256").update(referenceBytes).digest("hex");
  const profile = imagePromptProfile(DEFAULT_IMAGE_PROMPT_SETTINGS.modelFamily);
  const snapshot: ImagePackageSnapshot = {
    sessionGeneration: 1, reviewGeneration: 1, confirmedReviewGeneration: 1,
    items: [{
      occurrenceId: "owned-no-model-fixture", incarnation: 1, sourceBytes, byteCount: sourceBytes.size, sourceHash,
      mimeType: "image/png", fileExtension: "png", dimensions: { width: WIDTH, height: HEIGHT, megapixels: WIDTH * HEIGHT / 1_000_000 },
      provenance: { intakeKind: "direct", sourceName: "no-model-reference.png", sourcePath: null, containerChain: [], containerName: null, containerHash: null, containerPath: null, pageNumber: null, relationshipId: null },
      settings: { ...DEFAULT_IMAGE_PROMPT_SETTINGS, requestedChanges: "Use a dark blue background with a cyan square and coral baseline. Preserve the visible NO MODEL label.", mustPreserve: "The visible NO MODEL label. This is a synthetic local fixture." },
      ocr: options.acceptedOcr
        ? { status: "accepted", detectedText: "NO MODEL", reviewedText: IMAGE_FIXTURE_OCR, operationGeneration: 1, reviewRevision: 1 }
        : { status: "off", detectedText: null, reviewedText: null, operationGeneration: 0, reviewRevision: 0 },
      warnings: [IMAGE_FIXTURE_NOTICE], reviewRevision: 1,
      expectedProfileVersion: profile.profileVersion, expectedProfileVerifiedAt: profile.lastVerifiedAt,
    }],
  };
  const built = await buildImagePromptPackage(snapshot, {
    hash: async (blob) => createHash("sha256").update(new Uint8Array(await blob.arrayBuffer())).digest("hex"),
    // The browser decoder is unavailable in Node. This adapter only accepts our exact owned PNG.
    decoder: { decode: async (blob) => {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.length !== referenceBytes.length || !bytes.every((byte, index) => byte === referenceBytes[index])) throw new Error("Unexpected fixture decoder input.");
      return { width: WIDTH, height: HEIGHT, close: () => undefined };
    } },
  });
  if (!built.ok) throw new Error(`Image fixture export failed: ${built.error.code}`);
  return { packageBytes: new Uint8Array(await built.output.packageBytes.arrayBuffer()), referenceBytes, resultBytes };
}
