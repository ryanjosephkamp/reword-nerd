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
  it("keeps production source free of remote endpoints and unapproved persistence clients", () => {
    // This catches a future production change silently adding a network or persistence side effect outside the preference adapter.
    const root = join(process.cwd(), "src");
    const deliberateNavigationDestinations = [
      "https://github.com/ryanjosephkamp/reword-nerd",
      "https://github.com/ryanjosephkamp/",
      "https://ryanjosephkamp.github.io",
      "https://github.com/sponsors/ryanjosephkamp",
    ] as const;
    const forbidden = [
      /https?:\/\//u,
      /\bfetch\s*\(/u,
      /\bXMLHttpRequest\b/u,
      /\bWebSocket\b/u,
      /\bEventSource\b/u,
      /\bsendBeacon\b/u,
      /\bserviceWorker\s*\.\s*register\b/u,
      /\bsessionStorage\s*\.\s*setItem\b/u,
      /\bindexedDB\s*\.\s*open\b/u,
      /\bcaches\s*\.\s*open\b/u,
    ];
    const findings = sourceFiles(root).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const sourceWithoutApprovedNavigation = deliberateNavigationDestinations.reduce(
        (current, destination) => current.replaceAll(destination, "APPROVED_NAVIGATION_DESTINATION"),
        source,
      );
      const forbiddenStorageMethod = /\.\s*(?:setItem|removeItem)\s*\(/u.test(source)
        && !path.endsWith(join("app", "workbench", "preferences.ts"));
      return [
        ...(forbiddenStorageMethod ? [`${relative(process.cwd(), path)} used a storage write outside the preference adapter`] : []),
        ...forbidden.flatMap((pattern) => pattern.test(sourceWithoutApprovedNavigation)
        ? [`${relative(process.cwd(), path)} matched ${pattern.source}`]
        : []),
      ];
    });

    expect(findings).toEqual([]);
  });

  it("allows exactly one explicit namespaced browser-storage key", () => {
    // This catches a second persistence namespace or an implicit key that privacy review cannot audit.
    const root = join(process.cwd(), "src");
    const keys = sourceFiles(root).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return [...source.matchAll(/["'`](reword-nerd:[^"'`]+)["'`]/gu)].map((match) => match[1]);
    });

    expect(keys).toEqual(["reword-nerd:preferences:v1"]);
  });
});
