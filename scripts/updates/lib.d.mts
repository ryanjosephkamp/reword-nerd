export type VideoPolicy =
  | { policy: "none" }
  | { policy: "exempt"; exemptionReason: string }
  | { policy: "required"; mp4Path: string; posterPath: string; transcriptPath: string };

export type ReleaseLedgerStatus = "draft" | "current" | "published" | "archived";

export interface ReleaseLedgerEntryBase {
  slug: string;
  title: string;
  summary: string;
  status: ReleaseLedgerStatus;
  date: string;
  author: string;
  tags: string[];
  relatedPrs: number[];
  markdownPath: string;
  visualChanges: boolean;
  video: VideoPolicy;
}

export interface ReleaseLedgerReleaseEntry extends ReleaseLedgerEntryBase {
  kind: "release";
  version: string;
  classification: "feature" | "maintenance";
}

export interface ReleaseLedgerArticleEntry extends ReleaseLedgerEntryBase {
  kind: "article";
  version?: never;
  classification?: never;
}

export type ReleaseLedgerEntry = ReleaseLedgerReleaseEntry | ReleaseLedgerArticleEntry;

export interface ReleaseLedgerV1 {
  schemaVersion: 1;
  site: {
    title: string;
    description: string;
    canonicalOrigin: "https://ryanjosephkamp.github.io";
    basePath: "/reword-nerd/updates/";
  };
  entries: ReleaseLedgerEntry[];
}

export function validateReleaseLedger<T>(input: T): T;
export function readReleaseLedger(rootDirectory: string): Promise<ReleaseLedgerV1>;
export function classifyRelease(version: string): "feature" | "maintenance";
export function checkUpdates(rootDirectory: string): Promise<{ ledger: ReleaseLedgerV1; posts: Map<string, string>; version: string }>;
export function renderUpdates(rootDirectory: string, outputDirectory?: string): Promise<string[]>;
export function validateRenderedPageScripts(html: string): string;
export function createUpdate(rootDirectory: string, options: { slug: string; title: string; date: string }): Promise<"created" | "unchanged">;
export function prepareRelease(rootDirectory: string, options: { version: string; title: string; date: string }): Promise<"created" | "unchanged">;
