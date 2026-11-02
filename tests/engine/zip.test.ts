import { TextReader, Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";

import { findClash, isSystemClutter, nameProblem } from "../../src/engine/paths";
import {
  createZipBudget,
  openZipArchive,
  readZip,
  ZipReadError,
  type RawZipEntry,
  type ReadZipOptions,
  type ZipArchive,
} from "../../src/engine/zip";

const text = new TextEncoder();
const anyBlob = new Blob([new Uint8Array(64 * 1024)]);
const MB = 1024 * 1024;

function entry(overrides: Partial<RawZipEntry> = {}): RawZipEntry {
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

function archive(entries: RawZipEntry[], events: string[] = []): ZipArchive {
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

function options(zip: ZipArchive, overrides: Partial<ReadZipOptions> = {}): ReadZipOptions {
  return {
    open: async () => zip,
    budget: createZipBudget(100 * MB),
    limitFor: () => 20 * MB,
    label: "ZIP file",
    maxEntries: 500,
    ...overrides,
  };
}

async function rejection(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ZipReadError);
  return (error as ZipReadError).message;
}

async function realZip(
  files: [string, string | Uint8Array<ArrayBuffer>][],
  options: { password?: string; modes?: Record<string, number> } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    useWebWorkers: false,
    ...(options.password ? { password: options.password } : {}),
  });
  for (const [path, contents] of files) {
    const reader =
      typeof contents === "string" ? new TextReader(contents) : new Uint8ArrayReader(contents);
    const mode = options.modes?.[path];
    await writer.add(path, reader, mode === undefined ? {} : { unixMode: mode });
  }
  return (await writer.close()) as Uint8Array<ArrayBuffer>;
}

/** Rewrites the stated unpacked size of every entry, as a lying archive would. */
function statedSize(bytes: Uint8Array<ArrayBuffer>, size: number): Uint8Array<ArrayBuffer> {
  const view = new DataView(bytes.buffer);
  for (let offset = 0; offset < bytes.length - 4; offset += 1) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x04034b50) view.setUint32(offset + 22, size, true);
    if (signature === 0x02014b50) view.setUint32(offset + 24, size, true);
  }
  return bytes;
}

describe("readZip", () => {
  it("unpacks a real ZIP in path order", async () => {
    const source = new Blob([
      await realZip([
        ["z/second.png", "second"],
        ["a/first.png", "first"],
      ]),
    ]);
    const contents = await readZip(source, options(await openZipArchive(source)));
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
    await readZip(anyBlob, options(archive([reading("b.png"), reading("a.png")], events)));
    expect(events).toEqual([
      "listed b.png",
      "listed a.png",
      "listed all",
      "read a.png",
      "read b.png",
      "closed",
    ]);
  });

  it("hands each file over before unpacking the next when asked to", async () => {
    // Catches a caller holding every unpacked file in memory at once.
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
    const contents = await readZip(
      anyBlob,
      options(archive([reading("a.png"), reading("b.png")])),
      async (file) => {
        events.push(`used ${file.path}`);
      },
    );
    expect(events).toEqual(["read a.png", "used a.png", "read b.png", "used b.png"]);
    expect(contents.files).toEqual([]);
  });

  it.each(["../escape.png", "/absolute.png", "C:/drive.png", "folder/./dot.png", "a\\..\\..\\b"])(
    "rejects the whole archive for the escaping name %s",
    async (path) => {
      const zip = archive([entry({ path }), entry({ path: "ok.png" })]);
      expect(await rejection(readZip(anyBlob, options(zip)))).toContain(
        "contains a file with an unsafe name",
      );
    },
  );

  it.each([
    ["folder/CON.png", /Windows reserves \(CON\)/],
    ["folder/trailing. ", /ends with a dot or space/],
    ["folder/name:stream.png", /colon/],
    [`folder/${"x".repeat(256)}.png`, /too long/],
  ])("refuses a wanted file named %s that can't be unpacked everywhere", async (path, reason) => {
    expect(await rejection(readZip(anyBlob, options(archive([entry({ path })]))))).toMatch(reason);
  });

  it("ignores such names on files it leaves packed", async () => {
    const zip = archive([entry({ path: "node_modules/x/aux.js" }), entry()]);
    const contents = await readZip(anyBlob, {
      ...options(zip),
      limitFor: (path) => (path.endsWith(".png") ? 100 : null),
    });
    expect(contents.others).toEqual(["node_modules/x/aux.js"]);
  });

  it("reads backslashes as folder separators", async () => {
    const contents = await readZip(anyBlob, options(archive([entry({ path: "folder\\a.png" })])));
    expect(contents.files.map(({ path }) => path)).toEqual(["folder/a.png"]);
  });

  it.each([
    ["cafe\u0301.png", "caf\u00e9.png", "two files with the same name"],
    ["A/Poster.png", "a/poster.PNG", "differ only in capital letters"],
    ["K.png", "\u212A.png", "two files with the same name"],
    ["a", "a/b.png", "a file and a folder with the same name"],
    ["Folder", "folder/b.png", "a file and a folder with the same name"],
  ])("rejects clashing names %s and %s before reading anything", async (first, second, why) => {
    const read = vi.fn();
    const zip = archive([entry({ path: first, read }), entry({ path: second, read })]);
    expect(await rejection(readZip(anyBlob, options(zip)))).toContain(why);
    expect(read).not.toHaveBeenCalled();
  });

  it("allows a folder entry alongside the files in it", async () => {
    const zip = archive([
      entry({ path: "album/", directory: true }),
      entry({ path: "album/a.png" }),
    ]);
    const contents = await readZip(anyBlob, options(zip));
    expect(contents.files.map(({ path }) => path)).toEqual(["album/a.png"]);
  });

  it("skips system clutter without offering it to the caller", async () => {
    // Catches macOS's "Icon\r" folder-icon file failing the control-character name check.
    const limitFor = vi.fn(() => 100);
    const zip = archive([
      entry({ path: "album/Icon\r" }),
      entry({ path: "__MACOSX/album/._a.png" }),
      entry({ path: "album/.DS_Store" }),
      entry({ path: "album/a.png" }),
    ]);
    const contents = await readZip(anyBlob, { ...options(zip), limitFor });
    expect(contents).toMatchObject({ others: [], skipped: [] });
    expect(limitFor.mock.calls).toEqual([["album/a.png"]]);
  });

  it("skips password-protected files and links instead of refusing the archive", async () => {
    // Catches one locked or linked file sinking every other file in the archive.
    const read = vi.fn();
    const zip = archive([
      entry({ path: "locked.png", encrypted: true, read }),
      entry({ path: "link.png", unixMode: 0o120777, read }),
      entry({ path: "fine.png" }),
    ]);
    const contents = await readZip(anyBlob, options(zip));
    expect(contents.files.map(({ path }) => path)).toEqual(["fine.png"]);
    expect(contents.skipped).toEqual([
      { path: "link.png", problem: "link", reason: expect.stringMatching(/link/) },
      { path: "locked.png", problem: "encrypted", reason: "This file is password-protected." },
    ]);
    expect(read).not.toHaveBeenCalled();
  });

  it("finds password protection and links in a real ZIP", async () => {
    const locked = new Blob([await realZip([["a.png", "a"]], { password: "pass-1234" })]);
    const linked = new Blob([
      await realZip([["link.png", "/etc"]], { modes: { "link.png": 0o120777 } }),
    ]);
    const read = (source: Blob) =>
      readZip(source, { ...options(archive([])), open: openZipArchive });
    expect((await read(locked)).skipped[0].problem).toBe("encrypted");
    expect((await read(linked)).skipped[0].problem).toBe("link");
  });

  it("skips oversized files and large ones that expand suspiciously, without reading them", async () => {
    const read = vi.fn();
    const zip = archive([
      entry({ path: "huge.png", uncompressedSize: 1_001, compressedSize: 1_001, read }),
      entry({ path: "bomb.png", uncompressedSize: 2 * MB, compressedSize: 9, read }),
    ]);
    const contents = await readZip(anyBlob, {
      ...options(zip),
      limitFor: (path) => (path === "huge.png" ? 1_000 : 10 * MB),
    });
    expect(contents.skipped).toEqual([
      expect.objectContaining({ path: "bomb.png", problem: "expands" }),
      expect.objectContaining({ path: "huge.png", problem: "too-large" }),
    ]);
    expect(read).not.toHaveBeenCalled();
  });

  it("allows small files that compress well", async () => {
    const zip = archive([
      entry({
        uncompressedSize: 3,
        compressedSize: 0,
      }),
      entry({ path: "spaces.txt", uncompressedSize: 3, compressedSize: 1 }),
    ]);
    const contents = await readZip(anyBlob, options(zip));
    expect(contents.files.map(({ path }) => path)).toEqual(["spaces.txt"]);
    expect(contents.skipped).toEqual([expect.objectContaining({ problem: "damaged" })]);
  });

  it("refuses an archive whose wanted files add up to far more than the archive", async () => {
    // Catches many files each just under the per-file ratio check adding up to a bomb.
    const read = vi.fn();
    const files = Array.from({ length: 50 }, (_, i) =>
      entry({ path: `${i}.png`, uncompressedSize: MB, compressedSize: 1_024, read }),
    );
    const message = await rejection(
      readZip(new Blob([new Uint8Array(51_200)]), options(archive(files))),
    );
    expect(message).toBe(
      "This ZIP file unpacks to far more than its own size, so it wasn't opened.",
    );
    expect(read).not.toHaveBeenCalled();
  });

  it("refuses a real 30 KB ZIP that would unpack to 30 MB", async () => {
    const zeros = new Uint8Array(MB);
    const bytes = await realZip(Array.from({ length: 30 }, (_, i) => [`files/${i}`, zeros]));
    expect(bytes.byteLength).toBeLessThan(100 * 1024);
    const source = new Blob([bytes]);
    expect(
      await rejection(readZip(source, { ...options(archive([])), open: openZipArchive })),
    ).toMatch(/unpacks to far more/);
  });

  it("names a file whose real size doesn't match the size the ZIP lists", async () => {
    const source = new Blob([statedSize(await realZip([["a.txt", "x".repeat(5_000)]]), 100)]);
    const contents = await readZip(source, { ...options(archive([])), open: openZipArchive });
    expect(contents.skipped).toEqual([
      {
        path: "a.txt",
        problem: "damaged",
        reason: "This file's contents don't match the size the ZIP lists, so it wasn't unpacked.",
      },
    ]);
  });

  it("stops listing at entry 501 without reading any, and closes", async () => {
    // Catches listing every entry of a huge archive before checking the count.
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
    const message = await rejection(readZip(anyBlob, options(zip)));
    expect(message).toContain("holds more than 500 files");
    expect({ listed, closed, reads: read.mock.calls.length }).toEqual({
      listed: 501,
      closed: 1,
      reads: 0,
    });
  });

  it("shares one unpacking budget and skips what would pass it", async () => {
    const budget = createZipBudget(5);
    const first = await readZip(anyBlob, { ...options(archive([entry()])), budget });
    expect(first.files).toHaveLength(1);
    expect(budget.remaining).toBe(2);
    const read = vi.fn();
    const second = await readZip(anyBlob, {
      ...options(archive([entry({ path: "next.png", read })])),
      budget,
    });
    expect(second.skipped).toEqual([
      expect.objectContaining({ path: "next.png", problem: "over-budget" }),
    ]);
    expect(second.skipped[0].reason).toContain("would pass 1 MB");
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
    const contents = await readZip(anyBlob, options(zip));
    expect(contents.skipped).toEqual([expect.objectContaining({ problem: "damaged" })]);
    expect(copied).toBe(false);
  });

  it("skips an entry shorter than it claims, and closes", async () => {
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
    const contents = await readZip(anyBlob, options(zip));
    expect(contents.skipped).toEqual([expect.objectContaining({ problem: "damaged" })]);
    expect(events.at(-1)).toBe("closed");
  });

  it("explains a file that isn't a ZIP at all", async () => {
    const source = new Blob([text.encode("PK\u0003\u0004 but not really a zip")]);
    expect(
      await rejection(readZip(source, { ...options(archive([])), open: openZipArchive })),
    ).toMatch(/^This ZIP file (couldn't be opened|is damaged)/);
  });
});

describe("shared path rules", () => {
  it("finds every kind of clash, and none between distinct names", () => {
    expect(findClash(["a/b.txt", "a/c.txt", "b"])).toBeNull();
    expect(findClash(["docs", "docs/readme.md"])).toEqual(["docs", "docs/readme.md"]);
    expect(findClash(["docs/readme.md", "Docs"])).toEqual(["docs/readme.md", "Docs"]);
    expect(findClash(["Straße.txt", "STRASSE.txt"])).toEqual(["Straße.txt", "STRASSE.txt"]);
  });

  it("knows system clutter from ordinary files", () => {
    for (const path of ["Icon\r", "a/Icon\r", "__MACOSX/a", "a/._b", ".DS_Store", "Thumbs.db"]) {
      expect(isSystemClutter(path)).toBe(true);
    }
    for (const path of ["Icon.png", "a/.gitignore", "notes.txt"]) {
      expect(isSystemClutter(path)).toBe(false);
    }
  });

  it("accepts portable names", () => {
    expect(nameProblem("src/main.ts")).toBeNull();
    expect(nameProblem("caf\u00e9/notes.md")).toBeNull();
  });
});
