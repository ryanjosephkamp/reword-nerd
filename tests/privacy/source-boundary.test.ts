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
      "https://github.com/ryanjosephkamp/reword-nerd/issues/new?template=bug_report.yml",
      "https://github.com/ryanjosephkamp/reword-nerd/issues/new?template=feature_request.yml",
      "https://github.com/ryanjosephkamp/reword-nerd/security/advisories/new",
      "https://github.com/ryanjosephkamp/",
      "https://ryanjosephkamp.github.io",
      "https://github.com/sponsors/ryanjosephkamp",
      "https://ryanjosephkamp.github.io/reword-nerd/",
      "https://developers.openai.com/api/docs/guides/image-generation",
      "https://ai.google.dev/gemini-api/docs/image-generation",
      "https://docs.x.ai/developers/model-capabilities/images/editing",
      "https://docs.bfl.ai/flux_2/flux2_image_editing",
      "https://developer.adobe.com/firefly-services/docs/firefly-api/guides/how-tos/cm-generate-image/feature-guide",
      "https://docs.ideogram.ai/using-ideogram/features-and-tools/remix",
      "https://docs.midjourney.com/hc/en-us/articles/32040250122381-Image-Prompts",
      "https://platform.stability.ai/docs/api-reference",
    ] as const;
    const preferenceAdapters = [
      join("app", "workbench", "preferences.ts"),
      join("image", "preferences.ts"),
    ];
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
      const remoteUrls = [...source.matchAll(/https?:\/\/[^\s"'`<>)\\]+/gu)].map((match) => match[0]);
      const unapprovedUrls = remoteUrls.filter(
        (destination) => !deliberateNavigationDestinations.includes(destination as typeof deliberateNavigationDestinations[number]),
      );
      const sourceWithoutNavigationUrls = source.replace(/https?:\/\/[^\s"'`<>)\\]+/gu, "NAVIGATION_DESTINATION");
      const forbiddenStorageMethod = /\.\s*(?:setItem|removeItem)\s*\(/u.test(source)
        && !preferenceAdapters.some((adapter) => path.endsWith(adapter));
      return [
        ...(forbiddenStorageMethod ? [`${relative(process.cwd(), path)} used a storage write outside the preference adapter`] : []),
        ...unapprovedUrls.map((destination) => `${relative(process.cwd(), path)} used unapproved remote destination ${destination}`),
        ...forbidden.flatMap((pattern) => pattern.test(sourceWithoutNavigationUrls)
        ? [`${relative(process.cwd(), path)} matched ${pattern.source}`]
        : []),
      ];
    });

    expect(findings).toEqual([]);
  });

  it("allows exactly the explicit Text and Image browser-storage keys", () => {
    // This catches an unaudited persistence namespace or an implicit key that privacy review cannot audit.
    const root = join(process.cwd(), "src");
    const keys = sourceFiles(root).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return [...source.matchAll(/["'`](reword-nerd:[^"'`]+)["'`]/gu)].map((match) => match[1]);
    });

    expect(keys).toEqual([
      "reword-nerd:preferences:v1",
      "reword-nerd:image-preferences:v1",
    ]);
  });
});
