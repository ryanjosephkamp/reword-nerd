import {
  openZipArchive,
  readArchive,
  safeArchivePath,
  type ReadArchiveOptions,
  type ZipArchive,
  type ZipEntry,
} from "../../../src/engine/images/archive";
import { ImageReadError } from "../../../src/engine/images/errors";
import { IMAGE_LIMITS } from "../../../src/engine/images/limits";
import { zipBytes } from "../../fixtures/images/samples";

const text = new TextEncoder();
const anyBlob = new Blob([Uint8Array.of(1)]);

function entry(overrides: Partial<ZipEntry> = {}): ZipEntry {
  const bytes = Uint8Array.of(1, 2, 3);
  return {
    path: "photo.png",
    directory: false,
    encrypted: false,
    compressedSize: bytes.byteLength,
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

function archive(entries: ZipEntry[], events: string[] = []): ZipArchive {
  return {
    async *entries() {
      for (const item of entries) {
        events.push(`listed ${item.path}`);
        yield item;
      }
      events.push("listed all");
    },
    close: async () => {
      events.push("closed");
    },
  };
}

function options(zip: ZipArchive, overrides: Partial<ReadArchiveOptions> = {}): ReadArchiveOptions {
  return {
    open: async () => zip,
    budget: { remaining: IMAGE_LIMITS.maxArchiveExpandedBytes },
    limitFor: () => IMAGE_LIMITS.maxImageBytes,
    label: "ZIP file",
    ...overrides,
  };
}

async function rejection(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ImageReadError);
  return (error as ImageReadError).message;
}

describe("readArchive", () => {
  it("unpacks a real ZIP in path order", async () => {
    const source = new Blob([
      await zipBytes([
        ["z/second.png", text.encode("second")],
        ["a/first.png", text.encode("first")],
      ]),
    ]);
    const contents = await readArchive(source, options(await openZipArchive(source)));
    expect(contents.files.map(({ path }) => path)).toEqual(["a/first.png", "z/second.png"]);
    expect(new TextDecoder().decode(contents.files[0].bytes)).toBe("first");
  });

  it("checks every entry before unpacking any, and always closes", async () => {
    const events: string[] = [];
    const reading = (path: string) =>
      entry({
        path,
        read: async (writable) => {
          events.push(`read ${path}`);
          const writer = writable.getWriter();
          await writer.write(Uint8Array.of(1, 2, 3));
          await writer.close();
        },
      });
    await readArchive(anyBlob, options(archive([reading("b.png"), reading("a.png")], events)));
    expect(events).toEqual([
      "listed b.png",
      "listed a.png",
      "listed all",
      "read a.png",
      "read b.png",
      "closed",
    ]);
  });

  it.each([
    "../escape.png",
    "/absolute.png",
    "C:/drive.png",
    "folder\\backslash.png",
    "folder/./dot.png",
    "folder/CON.png",
    "folder/trailing. ",
    "folder/name:stream.png",
    `folder/${"x".repeat(256)}.png`,
  ])("rejects the whole archive for the unsafe name %s", async (path) => {
    expect(safeArchivePath(path)).toBeNull();
    const message = await rejection(readArchive(anyBlob, options(archive([entry({ path })]))));
    expect(message).toContain("contains a file with an unsafe name");
  });

  it.each([
    ["cafe\u0301.png", "caf\u00e9.png"],
    ["A/Poster.png", "a/poster.PNG"],
    ["K.png", "\u212A.png"],
    ["a", "a/b.png"],
    ["Folder", "folder/b.png"],
  ])("rejects clashing names %s and %s before reading anything", async (first, second) => {
    const read = vi.fn();
    const zip = archive([entry({ path: first, read }), entry({ path: second, read })]);
    const message = await rejection(readArchive(anyBlob, options(zip)));
    expect(message).toContain("contains files whose names clash");
    expect(read).not.toHaveBeenCalled();
  });

  it("allows a folder entry alongside the files in it", async () => {
    const zip = archive([
      entry({ path: "album/", directory: true }),
      entry({ path: "album/a.png" }),
    ]);
    const contents = await readArchive(anyBlob, options(zip));
    expect(contents.files.map(({ path }) => path)).toEqual(["album/a.png"]);
  });

  it("rejects password protection and links", async () => {
    const encrypted = archive([entry({ encrypted: true })]);
    expect(await rejection(readArchive(anyBlob, options(encrypted)))).toBe(
      "This ZIP file is password-protected. Remove the password and add it again.",
    );
    const link = archive([entry({ unixMode: 0o120777 })]);
    expect(await rejection(readArchive(anyBlob, options(link)))).toContain(
      "contains a link to another file",
    );
  });

  it("ignores password protection on files it leaves packed", async () => {
    const zip = archive([entry({ path: "notes.txt", encrypted: true }), entry()]);
    const contents = await readArchive(anyBlob, {
      ...options(zip),
      limitFor: (path) => (path.endsWith(".png") ? 100 : null),
    });
    expect(contents.others).toEqual(["notes.txt"]);
    expect(contents.files).toHaveLength(1);
  });

  it("skips oversized and suspiciously compressed files without reading them", async () => {
    const read = vi.fn();
    const zip = archive([
      entry({ path: "huge.png", uncompressedSize: 1_001, compressedSize: 1_001, read }),
      entry({ path: "bomb.png", uncompressedSize: 1_000, compressedSize: 9, read }),
    ]);
    const contents = await readArchive(anyBlob, { ...options(zip), limitFor: () => 1_000 });
    expect(contents.skipped).toEqual([
      expect.objectContaining({ path: "huge.png", problem: "too-large" }),
      expect.objectContaining({ path: "bomb.png", problem: "unreadable" }),
    ]);
    expect(read).not.toHaveBeenCalled();
  });

  it("treats impossible sizes as damage", async () => {
    const zip = archive([entry({ uncompressedSize: 1, compressedSize: 0 })]);
    expect(await rejection(readArchive(anyBlob, options(zip)))).toBe(
      "This ZIP file is damaged and couldn't be opened.",
    );
  });

  it("refuses ratio bombs", async () => {
    const zip = archive([entry({ uncompressedSize: 1_000, compressedSize: 9 })]);
    const contents = await readArchive(anyBlob, { ...options(zip), limitFor: () => 10_000 });
    expect(contents.skipped[0].reason).toBe(
      "This file unpacks to far more than its stored size, so it wasn't opened.",
    );
  });

  it("stops listing at entry 501 without reading any, and closes", async () => {
    let listed = 0;
    let closed = 0;
    const read = vi.fn();
    const zip: ZipArchive = {
      async *entries() {
        for (let index = 0; index < 600; index += 1) {
          listed += 1;
          yield entry({ path: `${String(index).padStart(3, "0")}.png`, read });
        }
      },
      close: async () => {
        closed += 1;
      },
    };
    const message = await rejection(readArchive(anyBlob, options(zip)));
    expect(message).toContain("holds more than 500 files");
    expect({ listed, closed, reads: read.mock.calls.length }).toEqual({
      listed: 501,
      closed: 1,
      reads: 0,
    });
  });

  it("shares one unpacking budget and skips what would pass it", async () => {
    const budget = { remaining: 5 };
    const first = await readArchive(anyBlob, { ...options(archive([entry()])), budget });
    expect(first.files).toHaveLength(1);
    expect(budget.remaining).toBe(2);
    const read = vi.fn();
    const second = await readArchive(anyBlob, {
      ...options(archive([entry({ path: "next.png", read })])),
      budget,
    });
    expect(second.skipped).toEqual([
      expect.objectContaining({ path: "next.png", problem: "too-large" }),
    ]);
    expect(second.skipped[0].reason).toContain("would pass 100 MB");
    expect(read).not.toHaveBeenCalled();
  });

  it("checks a chunk's length before copying it", async () => {
    let copied = false;
    const forged = {
      byteLength: 4,
      [Symbol.iterator]() {
        copied = true;
        throw new Error("copied before the length check");
      },
    } as unknown as Uint8Array;
    const zip = archive([
      entry({
        read: async (writable) => {
          const writer = writable.getWriter();
          await writer.write(forged);
          await writer.close();
        },
      }),
    ]);
    expect(await rejection(readArchive(anyBlob, options(zip)))).toBe(
      "This ZIP file is damaged and couldn't be opened.",
    );
    expect(copied).toBe(false);
  });

  it("rejects an entry shorter than it claims, and closes", async () => {
    const events: string[] = [];
    const zip = archive(
      [
        entry({
          read: async (writable) => {
            const writer = writable.getWriter();
            await writer.write(Uint8Array.of(1, 2));
            await writer.close();
          },
        }),
      ],
      events,
    );
    const message = await rejection(readArchive(anyBlob, { ...options(zip), label: "Word file" }));
    expect(message).toBe("This Word file is damaged and couldn't be opened.");
    expect(events.at(-1)).toBe("closed");
  });

  it("explains a file that isn't a ZIP at all", async () => {
    const source = new Blob([text.encode("PK\u0003\u0004 but not really a zip")]);
    expect(
      await rejection(readArchive(source, options(archive([]), { open: openZipArchive }))),
    ).toMatch(/^This ZIP file (couldn't be opened|is damaged)/);
  });
});
