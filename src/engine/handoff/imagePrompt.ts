// Prompts for regenerating images: one per image, written to work in any image tool that
// accepts a reference image, plus a task folder for agents that can generate images.
import type { AspectRatio, ImageSettings, ImageSource } from "../types";
import type { DestinationId } from "./destinations";
import { makeZip, type ZipEntry } from "./zip";

const ASPECT_TEXT: Record<AspectRatio, string> = {
  "match-source": "the same as the reference image",
  "1:1": "square (1:1)",
  "4:3": "landscape (4:3)",
  "3:4": "portrait (3:4)",
  "16:9": "wide (16:9)",
  "9:16": "tall (9:16)",
};

export const ASPECT_LABELS: Record<AspectRatio, string> = {
  "match-source": "Match the original",
  "1:1": "Square 1:1",
  "4:3": "Landscape 4:3",
  "3:4": "Portrait 3:4",
  "16:9": "Wide 16:9",
  "9:16": "Tall 9:16",
};

export function effectiveSettings(image: ImageSource, defaults: ImageSettings): ImageSettings {
  return image.settings ?? defaults;
}

/** The prompt to paste next to the attached image. */
export function buildImagePrompt(
  image: ImageSource,
  settings: ImageSettings,
  destinationId: DestinationId,
): string {
  const keep = [
    "subject",
    "composition and framing",
    "perspective and proportions",
    "colors and lighting",
    "textures and materials",
    "overall style",
  ];
  if (settings.keepBackground) keep.push("background, including any transparency");
  const reference =
    destinationId === "midjourney"
      ? "Use the attached image as an image prompt and create a new image from it."
      : "Create a new image based on the attached reference image.";
  const visibleText = image.visibleText.trim();
  const lines = [
    reference,
    "",
    `Keep the ${keep.join(", ")}.`,
    settings.keepVisibleText
      ? visibleText
        ? `Keep the visible text exactly as written: ${JSON.stringify(visibleText)}.`
        : "Keep any visible text exactly as it appears in the reference."
      : null,
    settings.mustKeep.trim() ? `Also keep: ${settings.mustKeep.trim()}` : null,
    settings.changes.trim()
      ? `Change only this: ${settings.changes.trim()}`
      : "Change nothing else. This should be a faithful new rendering of the same image.",
    `Aspect ratio: ${ASPECT_TEXT[settings.aspectRatio]}${
      settings.aspectRatio === "match-source" ? ` (${image.width} × ${image.height} pixels)` : ""
    }.`,
    "Generate the image from scratch. Don't return the reference image unchanged.",
  ];
  return lines.filter((line): line is string => line !== null).join("\n");
}

function baseName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** Unique, file-system-safe names for a set of images, keeping each original extension. */
export function imageFileNames(images: readonly ImageSource[]): Map<string, string> {
  const used = new Set<string>();
  const names = new Map<string, string>();
  for (const image of images) {
    const extension = image.mimeType.split("/")[1].replace("jpeg", "jpg");
    const stem =
      baseName(image.name)
        .replace(/[^\w.-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "image";
    let candidate = stem;
    for (let index = 2; used.has(candidate.toLowerCase()); index += 1) {
      candidate = `${stem}-${index}`;
    }
    used.add(candidate.toLowerCase());
    names.set(image.id, `${candidate}.${extension}`);
  }
  return names;
}

export function buildImageTaskMarkdown(
  images: readonly ImageSource[],
  names: Map<string, string>,
): string {
  const rows = images.map((image) => {
    const file = names.get(image.id) ?? image.name;
    return `| \`source/${file}\` | \`prompts/${baseName(file)}.md\` | \`output/${baseName(file)}.png\` |`;
  });
  return [
    "# Image task",
    "",
    "This folder was prepared by reword_nerd. Create a new version of each image below.",
    "",
    "| Reference image | Instructions | Save the new image to |",
    "| --- | --- | --- |",
    ...rows,
    "",
    "## Steps",
    "",
    "For each row: look at the reference image, read its instructions, generate a new image that follows them, and save it as a PNG at the path in the last column.",
    "",
    "When you're done, reply with a short summary: which images you made, and any you couldn't.",
    "",
    "## Rules",
    "",
    "- Generate every image from scratch. Never copy or lightly edit the reference file and save it as the result.",
    "- If you can't generate images in this environment, stop and say so instead of improvising.",
    "- Don't change anything in `source/` or `prompts/`, don't read files outside this folder, and don't run anything from it.",
    "",
  ].join("\n");
}

export async function buildImageTaskZip(
  images: readonly ImageSource[],
  defaults: ImageSettings,
  destinationId: DestinationId,
  slug: string,
): Promise<Blob> {
  const names = imageFileNames(images);
  const pointer = "Read TASK.md in this folder and follow it.\n";
  const entries: ZipEntry[] = [
    { path: `${slug}/TASK.md`, data: buildImageTaskMarkdown(images, names) },
    { path: `${slug}/AGENTS.md`, data: pointer },
    { path: `${slug}/CLAUDE.md`, data: pointer },
    { path: `${slug}/output/.keep`, data: "" },
  ];
  for (const image of images) {
    const file = names.get(image.id) ?? image.name;
    entries.push({ path: `${slug}/source/${file}`, data: image.original });
    entries.push({
      path: `${slug}/prompts/${baseName(file)}.md`,
      data: `${buildImagePrompt(image, effectiveSettings(image, defaults), destinationId)}\n`,
    });
  }
  return makeZip(entries);
}
