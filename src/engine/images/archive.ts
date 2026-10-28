// The image reader's view of a ZIP or Word file: the shared ZIP reader's rules, with its
// messages and skips put in image terms.
import {
  createZipBudget,
  readZip,
  ZipReadError,
  type ReadZipOptions,
  type UnpackedFile,
  type ZipBudget,
  type ZipSkip,
} from "../zip";
import { ImageReadError, type ImageProblem } from "./errors";
import { IMAGE_LIMITS } from "./limits";

export function createUnpackBudget(): ZipBudget {
  return createZipBudget(IMAGE_LIMITS.maxArchiveExpandedBytes);
}

export interface ArchiveSkip {
  path: string;
  reason: string;
  problem: ImageProblem;
}

export interface ArchiveContents {
  files: UnpackedFile[];
  skipped: ArchiveSkip[];
  others: string[];
}

function imageProblem({ problem }: ZipSkip): ImageProblem {
  return problem === "too-large" || problem === "over-budget" ? "too-large" : "unreadable";
}

export async function readImageArchive(
  source: Blob,
  options: Omit<ReadZipOptions, "maxEntries">,
  onFile?: (file: UnpackedFile) => Promise<void>,
): Promise<ArchiveContents> {
  try {
    const contents = await readZip(
      source,
      { ...options, maxEntries: IMAGE_LIMITS.maxArchiveEntries },
      onFile,
    );
    return {
      ...contents,
      skipped: contents.skipped.map((skip) => ({ ...skip, problem: imageProblem(skip) })),
    };
  } catch (error) {
    if (error instanceof ZipReadError) throw new ImageReadError(error.message);
    throw error;
  }
}
