import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { IMAGE_PROMPT_PROFILES } from "../../src/image/profiles";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  }).filter((path) => /\.(?:ts|tsx|css)$/.test(path));
}

const approvedRuntimeDestinations = [
  "https://github.com/ryanjosephkamp/reword-nerd",
  "https://github.com/ryanjosephkamp/reword-nerd/issues/new?template=bug_report.yml",
  "https://github.com/ryanjosephkamp/reword-nerd/issues/new?template=feature_request.yml",
  "https://github.com/ryanjosephkamp/reword-nerd/security/advisories/new",
  "https://github.com/ryanjosephkamp/",
  "https://ryanjosephkamp.github.io",
  "https://github.com/sponsors/ryanjosephkamp",
  "https://ryanjosephkamp.github.io/reword-nerd/",
] as const;

const profileDocumentationDestinations = [
  "https://developers.openai.com/api/docs/guides/image-generation",
  "https://ai.google.dev/gemini-api/docs/image-generation",
  "https://docs.x.ai/developers/model-capabilities/images/editing",
  "https://docs.bfl.ai/flux_2/flux2_image_editing",
  "https://developer.adobe.com/firefly-services/docs/firefly-api/guides/how-tos/cm-generate-image/feature-guide",
  "https://docs.ideogram.ai/using-ideogram/features-and-tools/remix",
  "https://docs.midjourney.com/hc/en-us/articles/32040250122381-Image-Prompts",
  "https://platform.stability.ai/docs/api-reference",
] as const;

const preferenceAdapterKeys = new Map([
  [join("app", "workbench", "preferences.ts"), "PREFERENCES_STORAGE_KEY"],
  [join("image", "preferences.ts"), "IMAGE_PREFERENCES_STORAGE_KEY"],
]);

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

const forbiddenWorkbenchImageModules = new Set([
  "imageValidation",
  "intakeCapacity",
  "safeArchive",
  "pdfIntake",
  "docxIntake",
]);

function workbenchLowLevelImportFindings(path: string, source: string): string[] {
  const displayPath = path.startsWith(process.cwd()) ? relative(process.cwd(), path) : path;
  if (!displayPath.split("/").join("\\").includes("src\\image\\workbench\\")) return [];
  const moduleSpecifiers = [
    ...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["']([^"']+)["']/gu),
  ].map((match) => match[1]);
  return moduleSpecifiers.flatMap((specifier) => {
    const moduleName = specifier.split("/").at(-1)?.replace(/\.(?:ts|tsx)$/u, "") ?? "";
    return forbiddenWorkbenchImageModules.has(moduleName)
      ? [`${displayPath} imported forbidden low-level Image module ${moduleName}`]
      : [];
  });
}

function boundaryFindings(path: string, source: string): string[] {
  const displayPath = path.startsWith(process.cwd()) ? relative(process.cwd(), path) : path;
  const remoteUrls = [...source.matchAll(/https?:\/\/[^\s"'`<>)\\]+/gu)].map((match) => match[0]);
  const unapprovedUrls = remoteUrls.filter(
    (destination) => {
      if (approvedRuntimeDestinations.includes(destination as typeof approvedRuntimeDestinations[number])) return false;
      const exactProfileLiteral = `officialSourceUrls: ["${destination}"]`;
      return !(path.endsWith(join("image", "profiles.ts"))
        && profileDocumentationDestinations.includes(destination as typeof profileDocumentationDestinations[number])
        && source.includes(exactProfileLiteral)
        && source.split(destination).length === 2);
    },
  );
  const sourceWithoutUrls = source.replace(/https?:\/\/[^\s"'`<>)\\]+/gu, "APPROVED_DESTINATION");
  const storageCalls = [...source.matchAll(/\.\s*(getItem|setItem|removeItem)\s*\(\s*([^,\n)]+)/gu)];
  const adapter = [...preferenceAdapterKeys].find(([suffix]) => path.endsWith(suffix));
  const storageFindings = storageCalls.flatMap((match) => {
    const method = match[1];
    const keyExpression = match[2].trim();
    if (!adapter) return [`${displayPath} used browser-storage call outside a preference adapter ${method}(${keyExpression})`];
    return keyExpression === adapter[1]
      ? []
      : [`${displayPath} used an unapproved browser-storage call ${method}(${keyExpression})`];
  });
  return [
    ...storageFindings,
    ...unapprovedUrls.map((destination) => `${displayPath} used unapproved remote destination ${destination}`),
    ...forbidden.flatMap((pattern) => pattern.test(sourceWithoutUrls)
      ? [`${displayPath} matched ${pattern.source}`]
      : []),
  ];
}

describe("production privacy boundary", () => {
  it("keeps production source free of remote endpoints and unapproved persistence clients", () => {
    // This catches a future production change silently adding a network or persistence side effect.
    const root = join(process.cwd(), "src");
    const findings = sourceFiles(root).flatMap((path) => boundaryFindings(path, readFileSync(path, "utf8")));

    expect(findings).toEqual([]);
  });

  it("rejects official documentation URLs outside exact profile metadata and arbitrary adapter storage keys", () => {
    // Catches a documentation allowlist becoming a runtime URL allowlist or an adapter becoming a general storage client.
    expect(boundaryFindings("src/image/unrelated.ts", [
      "export const endpoint = 'https://developers.openai.com/api/docs/guides/image-generation';",
      "fetch(endpoint);",
    ].join("\n"))).toEqual([
      "src/image/unrelated.ts used unapproved remote destination https://developers.openai.com/api/docs/guides/image-generation",
      "src/image/unrelated.ts matched \\bfetch\\s*\\(",
    ]);
    expect(boundaryFindings("src/image/preferences.ts", "storage.setItem(dynamicKey, serialized);"))
      .toEqual(["src/image/preferences.ts used an unapproved browser-storage call setItem(dynamicKey)"]);
  });

  it("rejects low-level intake imports from every Image workbench module", () => {
    // Catches UI code bypassing the public Image facade and taking ownership of validation or extraction internals.
    const fixture = [
      'import "../imageValidation";',
      'export { readSafeArchive } from "../safeArchive.ts";',
      'const capacity = import("../intakeCapacity");',
      'import type { ImagePdfAdapter } from "../pdfIntake";',
      'import type { DocxConverterAdapter } from "../docxIntake";',
      'import { createBrowserImageIntakeService } from "../intake";',
    ].join("\n");

    expect(workbenchLowLevelImportFindings("src/image/workbench/unsafe.ts", fixture)).toEqual([
      "src/image/workbench/unsafe.ts imported forbidden low-level Image module imageValidation",
      "src/image/workbench/unsafe.ts imported forbidden low-level Image module safeArchive",
      "src/image/workbench/unsafe.ts imported forbidden low-level Image module intakeCapacity",
      "src/image/workbench/unsafe.ts imported forbidden low-level Image module pdfIntake",
      "src/image/workbench/unsafe.ts imported forbidden low-level Image module docxIntake",
    ]);
  });

  it("keeps production Image workbench modules on public facades", () => {
    const root = join(process.cwd(), "src", "image", "workbench");
    const findings = existsSync(root)
      ? sourceFiles(root).flatMap((path) => workbenchLowLevelImportFindings(path, readFileSync(path, "utf8")))
      : [];

    expect(findings).toEqual([]);
  });

  it("binds each official documentation URL to its exact Image profile tuple", () => {
    // Catches a trusted documentation URL being reassigned to a different family/model record.
    expect(IMAGE_PROMPT_PROFILES.map(({ id, referenceModel, officialSourceUrls }) => ({ id, referenceModel, officialSourceUrls }))).toEqual([
      { id: "openai-gpt-image", referenceModel: "gpt-image-2 edit", officialSourceUrls: ["https://developers.openai.com/api/docs/guides/image-generation"] },
      { id: "google-nano-banana", referenceModel: "Nano Banana 2 / Gemini 3.1 Flash Image", officialSourceUrls: ["https://ai.google.dev/gemini-api/docs/image-generation"] },
      { id: "xai-grok-imagine", referenceModel: "grok-imagine-image-2.0", officialSourceUrls: ["https://docs.x.ai/developers/model-capabilities/images/editing"] },
      { id: "bfl-flux", referenceModel: "FLUX.2", officialSourceUrls: ["https://docs.bfl.ai/flux_2/flux2_image_editing"] },
      { id: "adobe-firefly", referenceModel: "Firefly Image 5", officialSourceUrls: ["https://developer.adobe.com/firefly-services/docs/firefly-api/guides/how-tos/cm-generate-image/feature-guide"] },
      { id: "ideogram", referenceModel: "Ideogram 3.0", officialSourceUrls: ["https://docs.ideogram.ai/using-ideogram/features-and-tools/remix"] },
      { id: "midjourney", referenceModel: "Midjourney V8.2", officialSourceUrls: ["https://docs.midjourney.com/hc/en-us/articles/32040250122381-Image-Prompts"] },
      { id: "stability-ai", referenceModel: "Stable Image / SD3.5", officialSourceUrls: ["https://platform.stability.ai/docs/api-reference"] },
      { id: "other-custom", referenceModel: "User-selected image model", officialSourceUrls: [] },
    ]);
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
