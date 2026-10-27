export interface ImageVideoInspection {
  readonly bytes: number;
  readonly codec: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationSeconds: number;
  readonly audioStreams: number;
}

export interface ImagePosterInspection {
  readonly bytes: number;
  readonly codec: string;
  readonly width: number;
  readonly height: number;
  readonly metadataTags: readonly string[];
}

export const IMAGE_QUICK_START_BUDGETS: Readonly<{
  webmBytes: number;
  mp4Bytes: number;
  posterBytes: number;
  aggregateBytes: number;
}>;

export const IMAGE_QUICK_START_MINIMUM_FREE_BYTES: bigint;

export function assertImageVideoDiskFloor(
  rootDirectory: string,
  inspect?: (path: string) => Promise<{ readonly bavail: bigint | number; readonly bsize: bigint | number }>,
): Promise<bigint>;

export function imageQuickStartMediaPaths(): {
  readonly mp4Path: string;
  readonly webmPath: string;
  readonly posterPath: string;
};

export function checkImageQuickStartMedia(rootDirectory: string): Promise<{
  readonly paths: ReturnType<typeof imageQuickStartMediaPaths>;
  readonly mp4: ImageVideoInspection;
  readonly webm: ImageVideoInspection;
  readonly poster: ImagePosterInspection;
  readonly aggregateBytes: number;
}>;

export function renderImageQuickStartMedia(rootDirectory: string): ReturnType<typeof checkImageQuickStartMedia>;
