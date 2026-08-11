import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  }).filter((path) => /\.(?:ts|tsx|css)$/.test(path));
}

describe("production privacy boundary", () => {
  it("keeps production source free of remote endpoints, persistence writes, and outbound clients", () => {
    // This catches a future production change silently adding a network or persistence side effect.
    const root = join(process.cwd(), "src");
    const forbidden = [
      /https?:\/\//u,
      /\bfetch\s*\(/u,
      /\bXMLHttpRequest\b/u,
      /\bWebSocket\b/u,
      /\bEventSource\b/u,
      /\bsendBeacon\b/u,
      /\bserviceWorker\s*\.\s*register\b/u,
      /\blocalStorage\s*\.\s*setItem\b/u,
      /\bsessionStorage\s*\.\s*setItem\b/u,
      /\bindexedDB\s*\.\s*open\b/u,
      /\bcaches\s*\.\s*open\b/u,
    ];
    const findings = sourceFiles(root).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return forbidden.flatMap((pattern) => pattern.test(source)
        ? [`${relative(process.cwd(), path)} matched ${pattern.source}`]
        : []);
    });

    expect(findings).toEqual([]);
  });
});
