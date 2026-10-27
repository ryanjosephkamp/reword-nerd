import { buildPromptPackage, type ExportSourceInput } from "../export";
import { assessContext, assessSourceContext } from "../domain/context";
import { CURATED_MODEL_PROFILES, createCustomProfile } from "../domain/profiles";
import { resolveSettings } from "../domain/settings";
import { createProjectPromptSnapshot } from "../domain/project";
import { renderPromptBundle, renderPromptSource, type PromptSourceContext } from "../prompting/renderPromptSet";
import type { PromptBundle } from "../domain/contracts";
import { buildImagePromptPackage } from "../image/export/package";
import type { ImagePackageSnapshotItem, ImagePackageBuildOptions } from "../image/export/contracts";
import { base64, canonical, digest, toWire, fromWire, type WireValue } from "./codec";
import { COLLECTION_LIMITS as L, boundedCount, boundedText, uniquePaths, type CollectionStage, COLLECTION_STAGES } from "./limits";
import { RUNTIME_ID, EFFORT_ID, type RuntimeChoice } from "./runtime.mjs";

export interface ExpectedOutput { id: string; memberId: string; path: string; kind: "document" | "changed-or-unchanged-file" | "rendition"; status: "missing" }
export interface CollectionMember {
  id: string; path: string; kind: "document" | "project" | "image"; format: string;
  packageBase64: string; packageSha256: string; packageBytes: number; preparation: WireValue | null;
  sourceManifest: WireValue; originalBytes: number; reviewedBytes: number; sourceSha256: string;
  settings: WireValue; settingsSha256: string; prompts: PromptBundle | null; imagePrompt: string | null;
  promptSha256: string; expectedOutputs: ExpectedOutput[]; omissions: string[];
}
export interface CollectionEnvelope {
  kind: "reword-nerd-collection"; schemaVersion: 1; id: string; revision: number; operation: "text" | "image";
  sharedInstruction: string; sharedInstructionSha256: string; runtime: RuntimeChoice | null; runtimeSha256: string;
  members: CollectionMember[]; expectedOutputs: ExpectedOutput[]; framingVersion: 1; resendOf: string | null;
}
export const memberId = (id: string) => typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(id);
export const collectionId = (id: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(id);
export function sourceContext(input: ExportSourceInput): PromptSourceContext {
  if (input.kind === "project") {
    const s = createProjectPromptSnapshot(input.project, 0);
    return { kind: "project", format: input.project.classification === "latex" ? "latex-project" : "text", assets: [], reviewedTreeHash: s.reviewedTreeHash, includedFiles: s.includedFiles, excludedPaths: s.excludedPaths, codeRewriteOptions: input.codeRewriteOptions, latexMainFile: input.project.rootDocument };
  }
  return { format: input.documentFormat, assets: (input.visualAssets ?? []).map(a => ({ id: a.id, filename: a.filename, mimeType: a.mimeType, pageNumber: a.pageNumber, sourcePath: a.sourcePath, caption: a.caption, altText: a.altText, included: a.included })), ...(input.documentFormat === "latex" ? { latexMainFile: input.latexProject?.mainFile } : {}) };
}
/** Validation keeps strings literal; old resolveSettings behavior stays available. */
export function literalSettings(input: ExportSourceInput["resolvedSettings"]): ExportSourceInput["resolvedSettings"] {
  resolveSettings(input);
  boundedText(input.customRequirements, L.instructionBytes, "Item requirements");
  boundedText(input.outputLanguage, 1024, "Output language");
  return { tone: input.tone, formality: input.formality, length: input.length, outputLanguage: input.outputLanguage, customRequirements: input.customRequirements };
}
export async function prepareTextMember(id: string, path: string, incoming: ExportSourceInput): Promise<CollectionMember> {
  if (!memberId(id)) throw Error("Invalid collection member ID"); uniquePaths([path]);
  const supplied = fromWire(JSON.parse(canonical(await toWire(incoming)))) as ExportSourceInput;
  const profile = supplied.chosenProfile.id === "custom" ? createCustomProfile(supplied.chosenProfile.label, supplied.chosenProfile.contextWindowTokens) : CURATED_MODEL_PROFILES.find(p => p.id === supplied.chosenProfile.id);
  if (!profile || canonical(profile) !== canonical(supplied.chosenProfile)) throw Error("Unsupported saved prompt guidance");
  const settings = literalSettings(supplied.resolvedSettings);
  const context = sourceContext(supplied);
  const isProject = supplied.kind === "project";
  if (!supplied.reviewed) throw Error(`${path}: review the source before preparing`);
  if (!isProject && ["latex", "latex-project"].includes(supplied.documentFormat)) throw Error(`${path}: LaTeX requires the reviewed project path; select a supported project or use manual export`);
  if (!isProject && (supplied.visualAssets ?? []).some(a => a.included)) throw Error(`${path}: included visual assets cannot be attached by the text adapter. Review asset exclusions or use manual export`);
  if (!isProject && (supplied.ocrCandidates ?? []).some(c => c.status === "pending" || (c.status === "accepted" && !supplied.reviewedExtractedText.includes(c.reviewedText)))) throw Error(`${path}: accepted OCR must appear literally in reviewed text; pending OCR must be reviewed`);
  const omissions = isProject ? supplied.project.entries.filter(e => !e.promptIncluded).map(e => `${e.path}: ${e.exclusionReason ?? "excluded"}; not transmitted`) : ["Original binary retained locally; only reviewed extraction is transmitted.", ...(supplied.visualAssets ?? []).map(a => `${a.filename}: excluded visual asset; not transmitted`)];
  let originals: number[];
  if (isProject) {
    boundedCount(supplied.project.entries.length, L.projectEntries, "Project entries");
    boundedCount(supplied.project.entries.filter(e => e.promptIncluded).length, L.includedProjectFiles, "Included project files");
    uniquePaths(supplied.project.entries.map(e => e.path));
    originals = supplied.project.entries.map(e => e.byteCount);
  } else originals = [supplied.original.size];
  for (const n of originals) boundedCount(n, L.originalBytes, "Original size");
  boundedText(supplied.reviewedExtractedText, L.reviewedBytes, "Reviewed member text");
  const prompts = renderPromptBundle(supplied.reviewedExtractedText, settings, profile, context);
  if (canonical(prompts) !== canonical(supplied.promptBundle)) throw Error("Canonical member prompt/source/settings binding mismatch");
  for (const prompt of [prompts.oneShot, ...Object.values(prompts.manual)]) boundedText(prompt, L.memberPromptBytes, "Canonical member prompt");
  const assessment = isProject && context.kind === "project" ? assessSourceContext({ kind: "project", includedFiles: context.includedFiles }, profile.contextWindowTokens) : assessContext(supplied.reviewedExtractedText, profile.contextWindowTokens);
  if (canonical(assessment) !== canonical(supplied.contextAssessment)) throw Error("Source context assessment mismatch");
  if (isProject && supplied.reviewedExtractedText !== renderPromptSource(context as Extract<PromptSourceContext, {kind: "project"}>)) throw Error("Reviewed project index mismatch");
  const input = { ...supplied, resolvedSettings: settings, chosenProfile: profile, uploadOrdinal: 0 };
  const built = await buildPromptPackage([input]);
  if (!built.ok) throw Error(`Public preparation validation: ${built.error.message}`);
  const pkg = new Uint8Array(await built.blob.arrayBuffer()); boundedCount(pkg.length, L.packageBytes, "Member package");
  const manifest = built.manifest.documents[0];
  const expectedOutputs: ExpectedOutput[] = isProject ? supplied.project.entries.filter(e => e.promptIncluded).map(e => ({ id: `${id}/file/${e.path}`, memberId: id, path: e.path, kind: "changed-or-unchanged-file", status: "missing" })) : [{ id: `${id}/final`, memberId: id, path, kind: "document", status: "missing" }];
  return { id, path, kind: isProject ? "project" : "document", format: manifest.format,
    packageBase64: base64(pkg), packageSha256: await digest(pkg), packageBytes: pkg.length, preparation: await toWire(input),
    sourceManifest: await toWire({ source: manifest.source, reviewedExtraction: manifest.reviewedExtraction, processing: manifest.processing, visualAssets: manifest.visualAssets, ocr: manifest.ocr }),
    originalBytes: originals.reduce((a, b) => a + b, 0), reviewedBytes: new TextEncoder().encode(input.reviewedExtractedText).length,
    sourceSha256: manifest.reviewedExtraction.sha256, settings: await toWire(settings), settingsSha256: await digest(canonical(settings)),
    prompts, imagePrompt: null, promptSha256: await digest(canonical(prompts)), expectedOutputs, omissions };
}
export async function prepareImageMember(id: string, path: string, item: ImagePackageSnapshotItem, options: ImagePackageBuildOptions = {}): Promise<CollectionMember> {
  if (!memberId(id)) throw Error("Invalid collection member ID"); uniquePaths([path]);
  if (item.mimeType !== "image/png" || item.fileExtension !== "png" || item.ocr.status === "accepted") throw Error(`${path}: connected images require PNG with no accepted OCR; preserve this item for manual export`);
  boundedCount(item.byteCount, L.imageBytes, "Image bytes"); boundedCount(item.dimensions.width, L.imageDimension, "Image width"); boundedCount(item.dimensions.height, L.imageDimension, "Image height");
  const built = await buildImagePromptPackage({ sessionGeneration: 1, reviewGeneration: 1, confirmedReviewGeneration: 1, items: [item] }, options);
  if (!built.ok) throw Error(`Public image preparation validation: ${built.error.message}`);
  const pkg = new Uint8Array(await built.output.packageBytes.arrayBuffer()); const pair = built.output.manifest.pairs[0];
  // Public prepared pairs retain the exact canonical text; never infer it from an image name.
  const profile = (await import("../image/profiles")).imagePromptProfile(item.settings.modelFamily);
  const imagePrompt = profile.promptBuilder({ ...item, id: item.occurrenceId } as never) + "\n";
  boundedText(imagePrompt, L.imagePromptBytes, "Image prompt");
  return { id, path, kind: "image", format: "png", packageBase64: base64(pkg), packageSha256: await digest(pkg), packageBytes: pkg.length, preparation: null,
    sourceManifest: await toWire(pair.source), originalBytes: item.byteCount, reviewedBytes: 0, sourceSha256: item.sourceHash,
    settings: await toWire(item.settings), settingsSha256: await digest(canonical(item.settings)), prompts: null, imagePrompt,
    promptSha256: await digest(imagePrompt), expectedOutputs: [{ id: `${id}/rendition`, memberId: id, path, kind: "rendition", status: "missing" }], omissions: [] };
}
export async function freezeCollection(members: CollectionMember[], options: { id: string; revision: number; sharedInstruction: string; runtime: RuntimeChoice | null; resendOf?: string | null }): Promise<CollectionEnvelope> {
  if (options.runtime !== null && (typeof options.runtime !== "object" || Object.keys(options.runtime).sort().join(",") !== "effort,model" || typeof options.runtime.model !== "string" || typeof options.runtime.effort !== "string" || !RUNTIME_ID.test(options.runtime.model) || !EFFORT_ID.test(options.runtime.effort))) throw Error("Malformed frozen runtime identifier");
  if (!collectionId(options.id) || !Number.isSafeInteger(options.revision) || options.revision < 1 || (options.resendOf && !collectionId(options.resendOf))) throw Error("Invalid collection revision/identity");
  if (!members.length || members.some(m => !memberId(m.id)) || new Set(members.map(m => m.id)).size !== members.length) throw Error("Missing or duplicate collection members");
  uniquePaths(members.map(m => m.path));
  const operation = members[0].kind === "image" ? "image" : "text";
  if (members.some(m => (m.kind === "image") !== (operation === "image"))) throw Error("Text and image generation use separate collections");
  boundedCount(members.length, operation === "image" ? L.imageMembers : L.textMembers, "Collection members");
  boundedCount(members.reduce((n, m) => n + m.packageBytes, 0), L.totalPackageBytes, "Combined packages");
  boundedCount(members.reduce((n, m) => n + m.originalBytes, 0), L.totalOriginalBytes, "Combined originals");
  boundedCount(members.reduce((n, m) => n + m.reviewedBytes, 0), L.totalReviewedBytes, "Combined reviewed text");
  boundedText(options.sharedInstruction, L.instructionBytes, "Shared instruction");
  boundedText(canonical(members.map(({id,path,kind,format,sourceManifest,settings,omissions,expectedOutputs})=>({id,path,kind,format,sourceManifest,settings,omissions,expectedOutputs}))), L.metadataBytes, "Collection inventory metadata");
  const envelope: CollectionEnvelope = { kind: "reword-nerd-collection", schemaVersion: 1, id: options.id, revision: options.revision, operation,
    sharedInstruction: options.sharedInstruction, sharedInstructionSha256: await digest(options.sharedInstruction), runtime: options.runtime,
    runtimeSha256: await digest(canonical(options.runtime)), members, expectedOutputs: members.flatMap(m => m.expectedOutputs), framingVersion: 1, resendOf: options.resendOf ?? null };
  boundedText(canonical(envelope), L.transportBytes, "Collection envelope");
  for (const stage of COLLECTION_STAGES) if (operation === "text") boundedText(canonical(members.map(m => m.prompts!.manual[stage])), L.initialPromptBytes, "Combined initial stage prompts");
  return envelope;
}
export type CollectionResponses = Partial<Record<CollectionStage, Record<string, string>>>;
