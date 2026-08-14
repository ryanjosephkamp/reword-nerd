import { Blob as NativeBlob } from "node:buffer";
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";

import {
  createExpandedByteBudget,
  readSafeArchive,
  type ArchiveEntryAdapter,
  type ArchiveReaderAdapter,
} from "../../src/image/safeArchive";
import type { ImageIntakeFailure } from "../../src/image/intakeContracts";

function issueCode(error: unknown): string | undefined {
  return (error as ImageIntakeFailure | undefined)?.issue?.code;
}

function fakeEntry(overrides: Partial<ArchiveEntryAdapter> = {}): ArchiveEntryAdapter {
  const bytes = overrides.uncompressedSize === undefined
    ? new Uint8Array([1, 2, 3])
    : new Uint8Array(Math.min(overrides.uncompressedSize, 32));
  return {
    path: "safe.png",
    directory: false,
    encrypted: false,
    compressedSize: Math.max(1, bytes.byteLength),
    uncompressedSize: bytes.byteLength,
    unixMode: null,
    read: async (writable) => {
      const writer = writable.getWriter();
      await writer.write(bytes);
      await writer.close();
    },
    ...overrides,
  };
}

function fakeReader(entries: readonly ArchiveEntryAdapter[], events: string[] = []): ArchiveReaderAdapter {
  return {
    async *entries() {
      for (const entry of entries) {
        events.push(`metadata:${entry.path}`);
        yield entry;
      }
      events.push("metadata:done");
    },
    close: async () => { events.push("closed"); },
  };
}

async function realZip(entries: readonly [string, string][]): Promise<Blob> {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  for (const [path, value] of entries) {
    await writer.add(path, new Uint8ArrayReader(new TextEncoder().encode(value)));
  }
  return new NativeBlob([await writer.close()], { type: "application/zip" }) as Blob;
}

describe("safe Image ZIP archive", () => {
  it("reads a real compact ZIP deterministically after fully auditing metadata", async () => {
    // Catches eager unordered ZIP intake or body reads beginning before the complete central directory audit.
    const archive = await realZip([["z/second.png", "second"], ["a/first.jpg", "first"]]);
    const result = await readSafeArchive(archive);
    expect(result.entries.map(({ path }) => path)).toEqual(["a/first.jpg", "z/second.png"]);
    expect(await Promise.all(result.entries.map(async ({ bytes }) => new TextDecoder().decode(bytes)))).toEqual([
      "first",
      "second",
    ]);

    const events: string[] = [];
    const entries = [
      fakeEntry({ path: "b.png", read: async (stream) => {
        events.push("read:b.png");
        const writer = stream.getWriter(); await writer.write(new Uint8Array([1, 2, 3])); await writer.close();
      } }),
      fakeEntry({ path: "a.png", read: async (stream) => {
        events.push("read:a.png");
        const writer = stream.getWriter(); await writer.write(new Uint8Array([1, 2, 3])); await writer.close();
      } }),
    ];
    const fake = await readSafeArchive(new NativeBlob([new Uint8Array([1])]) as Blob, {
      open: async () => fakeReader(entries, events),
    });
    expect(fake.entries.map(({ path }) => path)).toEqual(["a.png", "b.png"]);
    expect(events.indexOf("metadata:done")).toBeLessThan(events.indexOf("read:a.png"));
    expect(events.at(-1)).toBe("closed");
  });

  it.each([
    ["../escape.png", "UNSAFE_PATH"],
    ["/absolute.png", "UNSAFE_PATH"],
    ["C:/drive.png", "UNSAFE_PATH"],
    ["folder\\backslash.png", "UNSAFE_PATH"],
    ["folder/./dot.png", "UNSAFE_PATH"],
    ["folder/CON.png", "UNSAFE_PATH"],
    ["folder/trailing. ", "UNSAFE_PATH"],
    ["folder/name:stream.png", "UNSAFE_PATH"],
    [`folder/${"x".repeat(256)}.png`, "UNSAFE_PATH"],
  ] as const)("rejects unsafe archive path %s", async (path, expected) => {
    // Catches traversal and non-portable path tricks escaping the extracted review tree.
    await expect(readSafeArchive(new NativeBlob([new Uint8Array([1])]) as Blob, {
      open: async () => fakeReader([fakeEntry({ path })]),
    })).rejects.toSatisfy((error: unknown) => issueCode(error) === expected);
  });

  it("rejects NFC duplicates and NFKC/case portability collisions before reading bodies", async () => {
    // Catches visually/case-equivalent paths overwriting one another on another filesystem.
    for (const paths of [
      ["cafe\u0301.png", "caf\u00e9.png"],
      ["A/Poster.png", "a/poster.PNG"],
      ["K.png", "\u212A.png"],
    ]) {
      let reads = 0;
      const entries = paths.map((path) => fakeEntry({ path, read: async () => { reads += 1; } }));
      await expect(readSafeArchive(new NativeBlob([new Uint8Array([1])]) as Blob, {
        open: async () => fakeReader(entries),
      })).rejects.toSatisfy((error: unknown) => issueCode(error) === "PATH_COLLISION");
      expect(reads).toBe(0);
    }
  });

  it("rejects file/descendant namespace conflicts including portable case/NFKC variants before reads", async () => {
    // Catches extraction trees where a file must simultaneously be a parent directory on another filesystem.
    for (const paths of [
      ["a", "a/b.png"],
      ["Folder", "folder/b.png"],
      ["K", "\u212A/b.png"],
    ]) {
      let reads = 0;
      await expect(readSafeArchive(new NativeBlob([new Uint8Array([1])]) as Blob, {
        open: async () => fakeReader(paths.map((path) => fakeEntry({
          path,
          read: async () => { reads += 1; },
        }))),
      })).rejects.toSatisfy((error: unknown) => issueCode(error) === "PATH_COLLISION");
      expect(reads).toBe(0);
    }
  });

  it.each([
    [fakeEntry({ encrypted: true }), "ENCRYPTED_ENTRY"],
    [fakeEntry({ unixMode: 0o120777 }), "LINK_ENTRY_UNSUPPORTED"],
    [fakeEntry({ path: "nested.zip" }), "NESTED_ARCHIVE"],
    [fakeEntry({ uncompressedSize: 20 * 1024 * 1024 + 1 }), "ARCHIVE_ENTRY_SIZE_EXCEEDED"],
    [fakeEntry({ uncompressedSize: 101, compressedSize: 1 }), "ARCHIVE_COMPRESSION_RATIO_EXCEEDED"],
    [fakeEntry({ uncompressedSize: 1, compressedSize: 0 }), "MALFORMED_ZIP"],
  ] as const)("rejects unsafe metadata without reading entry bodies", async (entry, expected) => {
    // Catches links, encryption, nesting, and bombs being detected only after allocation.
    let reads = 0;
    const candidate = { ...entry, read: async () => { reads += 1; } };
    await expect(readSafeArchive(new NativeBlob([new Uint8Array([1])]) as Blob, {
      open: async () => fakeReader([candidate]),
    })).rejects.toSatisfy((error: unknown) => issueCode(error) === expected);
    expect(reads).toBe(0);
  });

  it("rejects renamed nested ZIP signatures after bounded extraction", async () => {
    // Catches a nested archive bypassing the extension check by using an image or neutral filename.
    const zipSignature = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    const entry = fakeEntry({
      path: "renamed.bin",
      uncompressedSize: zipSignature.byteLength,
      compressedSize: zipSignature.byteLength,
      read: async (stream) => {
        const writer = stream.getWriter(); await writer.write(zipSignature); await writer.close();
      },
    });
    await expect(readSafeArchive(new NativeBlob([new Uint8Array([1])]) as Blob, {
      open: async () => fakeReader([entry]),
    })).rejects.toSatisfy((error: unknown) => issueCode(error) === "NESTED_ARCHIVE");
  });

  it("retains an exact DOCX entry for the required downstream OOXML structural audit", async () => {
    // Catches the nested-ZIP signature guard accidentally making ZIP → DOCX intake impossible.
    const docxSignature = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    const entry = fakeEntry({
      path: "documents/image-only.docx",
      uncompressedSize: docxSignature.byteLength,
      compressedSize: docxSignature.byteLength,
      read: async (stream) => {
        const writer = stream.getWriter(); await writer.write(docxSignature); await writer.close();
      },
    });
    await expect(readSafeArchive(new NativeBlob([new Uint8Array([1])]) as Blob, {
      open: async () => fakeReader([entry]),
    })).resolves.toMatchObject({
      entries: [{ path: "documents/image-only.docx", bytes: docxSignature }],
    });
  });

  it("aborts on metadata record 501 without materializing or reading it and always closes", async () => {
    // Catches getEntries-style eager metadata allocation past the fixed 500-entry cap.
    let yielded = 0;
    let reads = 0;
    let closed = 0;
    const reader: ArchiveReaderAdapter = {
      async *entries() {
        for (let index = 0; index < 600; index += 1) {
          yielded += 1;
          yield fakeEntry({ path: `${String(index).padStart(3, "0")}.png`, read: async () => { reads += 1; } });
        }
      },
      close: async () => { closed += 1; },
    };
    await expect(readSafeArchive(new NativeBlob([new Uint8Array([1])]) as Blob, {
      open: async () => reader,
    })).rejects.toSatisfy((error: unknown) => issueCode(error) === "ARCHIVE_ENTRY_COUNT_EXCEEDED");
    expect({ yielded, reads, closed }).toEqual({ yielded: 501, reads: 0, closed: 1 });
  });

  it("rejects an overflowing decompression chunk before retaining it and shares the cumulative budget", async () => {
    // Catches post-allocation byte checks and separate nested budgets exceeding the selected top-level subtree cap.
    const budget = createExpandedByteBudget(5);
    const first = fakeEntry({
      path: "first.png",
      uncompressedSize: 4,
      compressedSize: 4,
      read: async (stream) => {
        const writer = stream.getWriter(); await writer.write(new Uint8Array([1, 2, 3, 4])); await writer.close();
      },
    });
    const accepted = await readSafeArchive(new NativeBlob([new Uint8Array([1])]) as Blob, {
      open: async () => fakeReader([first]), budget,
    });
    expect(accepted.entries[0].bytes).toHaveLength(4);
    expect(budget.usedBytes).toBe(4);

    let bodyReads = 0;
    const second = fakeEntry({
      path: "second.png",
      uncompressedSize: 2,
      compressedSize: 2,
      read: async (stream) => {
        bodyReads += 1;
        const writer = stream.getWriter();
        await writer.write(new Uint8Array([5, 6]));
        await writer.close();
      },
    });
    await expect(readSafeArchive(new NativeBlob([new Uint8Array([1])]) as Blob, {
      open: async () => fakeReader([second]), budget,
    })).rejects.toSatisfy((error: unknown) => issueCode(error) === "ARCHIVE_EXPANDED_SIZE_EXCEEDED");
    expect(bodyReads).toBe(0);
    expect(budget.usedBytes).toBe(4);
  });

  it("checks raw chunk length before copying malformed decompressor output", async () => {
    // Catches Uint8Array.from allocating or invoking a hostile iterator before the audited length guard.
    let iteratorCalled = false;
    const forged = {
      byteLength: 4,
      [Symbol.iterator]() {
        iteratorCalled = true;
        throw new Error("copy happened before limit check");
      },
    } as unknown as Uint8Array;
    const entry = fakeEntry({
      uncompressedSize: 3,
      compressedSize: 3,
      read: async (stream) => {
        const writer = stream.getWriter(); await writer.write(forged); await writer.close();
      },
    });
    await expect(readSafeArchive(new NativeBlob([new Uint8Array([1])]) as Blob, {
      open: async () => fakeReader([entry]),
    })).rejects.toSatisfy((error: unknown) => issueCode(error) === "ARCHIVE_LENGTH_MISMATCH");
    expect(iteratorCalled).toBe(false);
  });

  it("rejects actual expanded-length mismatch and closes the reader", async () => {
    // Catches a local header/body disagreement being accepted from audited central-directory metadata.
    const events: string[] = [];
    const entry = fakeEntry({
      uncompressedSize: 3,
      compressedSize: 3,
      read: async (stream) => {
        const writer = stream.getWriter(); await writer.write(new Uint8Array([1, 2])); await writer.close();
      },
    });
    await expect(readSafeArchive(new NativeBlob([new Uint8Array([1])]) as Blob, {
      open: async () => fakeReader([entry], events),
    })).rejects.toSatisfy((error: unknown) => issueCode(error) === "ARCHIVE_LENGTH_MISMATCH");
    expect(events.at(-1)).toBe("closed");
  });
});
