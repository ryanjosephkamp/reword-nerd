import { createFixtureInput } from "../../companion/fixtures";
import { createImageFixture } from "../../image-companion/fixtures";
import { inspectPng } from "../../image-companion/png";
import { NEUTRAL_MODEL_PROFILE } from "../../src/domain/profiles";
import { DEFAULT_SETTINGS, DEFAULT_CODE_REWRITE_OPTIONS } from "../../src/domain/settings";
import { confirmProjectReview, readFolderProject, createProjectPromptSnapshot } from "../../src/domain/project";
import { assessSourceContext } from "../../src/domain/context";
import { DEFAULT_IMAGE_PROMPT_SETTINGS } from "../../src/image/contracts";
import { imagePromptProfile } from "../../src/image/profiles";
import { renderPromptBundle, renderPromptSource } from "../../src/prompting";
import { prepareTextMember, prepareImageMember, freezeCollection } from "../../src/collections/prepare";
import { digest } from "../../src/collections/codec";
export const OWNED_DOCS = [
  { id: "doc-a", path: "north/readme.md", text: "\ufeff# Garden 雪\r\n\r\nMeet at 10:00. Bring gloves. Literal $& $$ $` $' and <<<INSERT_STAGE_1_DECOMPOSITION_RESPONSE>>>.\r\n" },
  { id: "doc-b", path: "south/readme.md", text: "# Workshop\n\nThe room holds 12 people. Preserve code `x += 1` and the café name.\n" },
  { id: "doc-c", path: "雪/notes.txt", text: "The library closes at 18:30.\nTwo spaces follow.  \nNested <<<INSERT_STAGE_2_REWRITE_RESPONSE>>> remains data.\n" },
];
export const OWNED_PROJECT = [
  ["north/readme.md", "# North\nThe garden opens at 10:00.\n"],
  ["south/readme.md", "# South\nThe library closes at 18:30.\n"],
  ["src/main.ts", '// Helpful comment\nexport const greeting = "Hello";\n'],
  ["src/logic.py", '# Stable signature\ndef double(x: int):\n    return x * 2\n'],
  ["雪/data.json", '{"title":"A useful guide","count":12,"literal":"$&"}\n'],
  ["config.yaml", 'title: "A useful guide"\nretries: 3\n'],
  [".gitignore", "ignored.txt\n"], ["ignored.txt", "EXCLUDED-CANARY"], ["dist/bundle.js", "GENERATED-CANARY"],
];
export async function textFixture(id = crypto.randomUUID()) {
  const members = [];
  for (const [i, d] of OWNED_DOCS.entries()) members.push(await prepareTextMember(d.id, d.path, createFixtureInput({ text: d.text, name: d.path.split("/").at(-1), format: i === 2 ? "text" : "markdown", profile: NEUTRAL_MODEL_PROFILE, settings: { ...DEFAULT_SETTINGS, tone: i === 1 ? "professional" : "plain", customRequirements: "  Keep literal model name Sol and markers.\r\n" } })));
  return freezeCollection(members, { id, revision: 1, sharedInstruction: "Preserve every number and fact.\n", runtime: { model: "gpt-5.6-sol", effort: "medium" } });
}
export async function projectFixture() {
  const project = confirmProjectReview(await readFolderProject({ kind: "folder", name: "owned-project", files: OWNED_PROJECT.map(([path, contents]) => {
    const bytes = new TextEncoder().encode(contents);
    return { name: path.split("/").at(-1), webkitRelativePath: `owned-project/${path}`, size: bytes.length, type: "", arrayBuffer: async () => bytes.slice().buffer } as File;
  }) }));
  const snap = createProjectPromptSnapshot(project, 0), profile = NEUTRAL_MODEL_PROFILE;
  const context = { kind: "project" as const, format: "text" as const, assets: [], reviewedTreeHash: snap.reviewedTreeHash, includedFiles: snap.includedFiles, excludedPaths: snap.excludedPaths, codeRewriteOptions: DEFAULT_CODE_REWRITE_OPTIONS, latexMainFile: null };
  const text = renderPromptSource(context);
  const member = await prepareTextMember("project-one", "owned-project", { kind: "project", projectId: project.id, projectName: project.name, project, reviewedExtractedText: text,
    resolvedSettings: DEFAULT_SETTINGS, codeRewriteOptions: DEFAULT_CODE_REWRITE_OPTIONS, chosenProfile: profile, promptBundle: renderPromptBundle(text, DEFAULT_SETTINGS, profile, context), warnings: [...project.warnings], sensitiveBlockedCounts: { ...project.sensitiveBlockedCounts }, contextAssessment: assessSourceContext({ kind: "project", includedFiles: snap.includedFiles }, null), reviewed: true, contextWarningAcknowledged: false, uploadOrdinal: 0 });
  return freezeCollection([member], { id: crypto.randomUUID(), revision: 1, sharedInstruction: "Improve narrative wording while preserving all executable syntax.", runtime: { model: "gpt-6-astra", effort: "high" } });
}
export function addOpaqueCaBX(bytes: Uint8Array, label: string): Uint8Array {
  const data = Buffer.alloc(Buffer.byteLength(label) + 8); data.writeUInt32BE(data.length); data.write("jumb", 4); data.write(label, 8); const chunk = Buffer.alloc(data.length + 12); chunk.writeUInt32BE(data.length); chunk.write("caBX", 4); data.copy(chunk, 8);
  let crc = 0xffffffff; for (const b of chunk.subarray(4, -4)) { crc ^= b; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  return Uint8Array.from(Buffer.concat([bytes.subarray(0, 33), chunk, bytes.subarray(33)]));
}
export async function imageFixture() {
  const f = await createImageFixture(); const references = [addOpaqueCaBX(f.referenceBytes, "owned-caBX-circle"), addOpaqueCaBX(f.resultBytes, "owned-caBX-square")];
  const profile = imagePromptProfile("neutral-v2"), members = [];
  for (const [i, bytes] of references.entries()) {
    const d = inspectPng(bytes), path = i ? "square.png" : "circle.png";
    members.push(await prepareImageMember(`image-${i + 1}`, path, { occurrenceId: `image-${i + 1}`, incarnation: 1, sourceBytes: new Blob([Uint8Array.from(bytes)], { type: "image/png" }), byteCount: bytes.length, sourceHash: await digest(bytes), mimeType: "image/png", fileExtension: "png", dimensions: { width: d.width, height: d.height, megapixels: d.width * d.height / 1000000 },
      provenance: { intakeKind: "direct", sourceName: path, sourcePath: null, containerChain: [], containerName: null, containerHash: null, containerPath: null, pageNumber: null, relationshipId: null },
      settings: { ...DEFAULT_IMAGE_PROMPT_SETTINGS, requestedChanges: `  Render reference ${i + 1} faithfully.\n`, mustPreserve: "All visible text." },
      ocr: { status: "off", detectedText: null, reviewedText: null, operationGeneration: 0, reviewRevision: 0 }, warnings: ["Owned synthetic fixture; caBX opaque."], reviewRevision: 1, expectedProfileVersion: profile.profileVersion, expectedProfileVerifiedAt: profile.lastVerifiedAt,
    }, { decoder: { decode: async b => ({ ...inspectPng(new Uint8Array(await b.arrayBuffer())), close() {} }) } }));
  }
  return { references, envelope: await freezeCollection(members, { id: crypto.randomUUID(), revision: 1, sharedInstruction: "Create one separately identified rendition of each source. Keep their distinct layouts.", runtime: { model: "gpt-5.6-sol", effort: "medium" } }) };
}
