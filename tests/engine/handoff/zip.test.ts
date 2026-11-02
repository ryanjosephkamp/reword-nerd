import { TextReader, Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";

import {
  isAgentResultPath,
  isWorkspacePart,
  makeZip,
  readZip,
  ZipReadError,
} from "../../../src/engine/handoff/zip";
import { openZipArchive, type ZipArchive } from "../../../src/engine/zip";

async function zipOf(files: [string, string | Uint8Array<ArrayBuffer>][], password?: string) {
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    useWebWorkers: false,
    ...(password ? { password } : {}),
  });
  for (const [path, data] of files) {
    await writer.add(
      path,
      typeof data === "string" ? new TextReader(data) : new Uint8ArrayReader(data),
    );
  }
  return new Blob([await writer.close()]);
}

/** Opens real ZIPs but records which entries were unpacked. */
function recordingOpener(read: string[]) {
  return async (source: Blob): Promise<ZipArchive> => {
    const zip = await openZipArchive(source);
    return {
      async *entries(signal) {
        for await (const entry of zip.entries(signal)) {
          yield {
            ...entry,
            read: (writable, abort) => {
              read.push(entry.path);
              return entry.read(writable, abort);
            },
          };
        }
      },
      close: () => zip.close(),
    };
  };
}

describe("reading returned ZIPs", () => {
  it("unpacks only the files the caller wants", async () => {
    // Catches a bring-back unpacking every original in source/ just to find output/.
    const blob = await makeZip([
      { path: "task/source/big.pdf", data: "original" },
      { path: "task/text/big.pdf.md", data: "text copy" },
      { path: "task/output/report.docx", data: "result" },
      { path: "task/REPORT.md", data: "# Report" },
    ]);
    const read: string[] = [];
    const files = await readZip(blob, { want: isAgentResultPath, open: recordingOpener(read) });
    expect(files.map((file) => file.path)).toEqual(["task/REPORT.md", "task/output/report.docx"]);
    expect(read.sort()).toEqual(["task/REPORT.md", "task/output/report.docx"]);
    expect(await files[1].data.text()).toBe("result");
  });

  it("refuses a small ZIP that would unpack to far more than its size", async () => {
    // Catches a 408 KB workspace file turning into hundreds of megabytes in memory.
    const zeros = new Uint8Array(1024 * 1024);
    const parts: [string, Uint8Array<ArrayBuffer>][] = Array.from({ length: 30 }, (_, i) => [
      `files/${i}`,
      zeros,
    ]);
    const blob = await zipOf([["workspace.json", "{}"], ...parts]);
    expect(blob.size).toBeLessThan(100 * 1024);
    await expect(readZip(blob, { want: isWorkspacePart })).rejects.toThrow(
      /unpacks to far more than its own size/,
    );
  });

  it("refuses the ZIP, saying why, when a wanted file can't be unpacked", async () => {
    const blob = await zipOf([["workspace.json", "{}"]], "pass-1234");
    const failure = readZip(blob, { want: isWorkspacePart });
    await expect(failure).rejects.toBeInstanceOf(ZipReadError);
    await expect(failure).rejects.toThrow(
      '"workspace.json" in this ZIP wasn\'t opened. This file is password-protected.',
    );
  });

  it("knows a workspace file's parts", () => {
    expect(["workspace.json", "files/0", "files/12"].every(isWorkspacePart)).toBe(true);
    expect(["files/x", "other/workspace.json", "files/1/2"].some(isWorkspacePart)).toBe(false);
  });

  it("knows an agent's results from the task's inputs", () => {
    for (const path of [
      "output/a.md",
      "task/output/a/b.md",
      "task/REPORT.md",
      "a.md",
      "notes/a.md",
    ]) {
      expect(isAgentResultPath(path)).toBe(true);
    }
    for (const path of [
      "source/a.md",
      "task/source/a.md",
      "task/text/a.md",
      "task/work/stage.md",
      "assets/x.png",
    ]) {
      expect(isAgentResultPath(path)).toBe(false);
    }
  });
});
