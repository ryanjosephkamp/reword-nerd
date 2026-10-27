export const RELEASE_VIDEO_BUDGETS: Readonly<{
  webmBytes: number;
  mp4Bytes: number;
  posterBytes: number;
  transcriptBytes: number;
  aggregateBytes: number;
}>;

export const RELEASE_VIDEO_MINIMUM_FREE_BYTES: bigint;
export const RELEASE_VIDEO_VERSIONS: readonly string[];

export interface ReleaseVideoConfiguration {
  readonly compositionId: "ReleaseUpdate" | "ReleaseUpdateV08";
  readonly stagingPrefix: string;
  readonly posterTimestamp: string;
  readonly transcript: string;
  readonly requiredTranscriptFragments: readonly string[];
  readonly forbidFirstPersonSingular: boolean;
}

export interface ReleaseMediaPaths {
  mp4Path: string;
  webmPath: string;
  posterPath: string;
  transcriptPath: string;
}

export interface VideoInspection {
  bytes: number;
  codec: string;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  audioStreams: number;
}

export interface PosterInspection {
  bytes: number;
  codec: string;
  width: number;
  height: number;
  metadataTags: string[];
}

export function releaseVideoConfiguration(version: string): ReleaseVideoConfiguration;
export function releaseVideoTranscript(version: string): string;
export function assertReleaseVideoDiskFloor(
  rootDirectory: string,
  inspect?: (path: string) => Promise<{ readonly bavail: bigint | number; readonly bsize: bigint | number }>,
): Promise<bigint>;
export function releaseRenderInvocation(rootDirectory: string, version: string, outputPath: string): {
  readonly executable: string;
  readonly args: string[];
};

export function releaseMediaPaths(version: string): ReleaseMediaPaths;
export function checkReleaseMedia(rootDirectory: string, version: string): Promise<{
  paths: ReleaseMediaPaths;
  mp4: VideoInspection;
  webm: VideoInspection;
  poster: PosterInspection;
  transcriptBytes: number;
  aggregateBytes: number;
}>;
export function checkReleaseMediaDirectory(directory: string, version: string): Promise<{
  mp4: VideoInspection;
  webm: VideoInspection;
  poster: PosterInspection;
  transcriptBytes: number;
  aggregateBytes: number;
}>;
export function publishReleaseMediaCandidate(
  candidateDirectory: string,
  targetDirectory: string,
  version: string,
  check?: (directory: string, version: string) => Promise<unknown>,
): Promise<void>;
export function renderReleaseMedia(rootDirectory: string, version: string): ReturnType<typeof checkReleaseMedia>;
