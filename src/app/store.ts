// The whole workspace in one store. Components subscribe to the slices they show, so typing
// in one panel doesn't re-render the others.
import { create } from "zustand";
import { DEFAULT_JOB, withGoal, type Goal, type RewriteJob } from "../engine/job";
import {
  DEFAULT_IMAGE_DESTINATION,
  DEFAULT_TEXT_DESTINATION,
  type DestinationId,
} from "../engine/handoff/destinations";
import type { Stage, StageReplies } from "../engine/handoff/textPrompt";
import type {
  ImageSettings,
  ImageSource,
  Rejection,
  TextProject,
  TextSource,
} from "../engine/types";

export type Mode = "text" | "images";
export type Scope = "all" | "selected";

export const DEFAULT_IMAGE_SETTINGS: Readonly<ImageSettings> = Object.freeze({
  aspectRatio: "match-source",
  keepVisibleText: true,
  keepBackground: true,
  changes: "",
  mustKeep: "",
});

/** What came back from the model, kept until the next hand-off. */
export interface TextResult {
  /** Source ids the hand-off covered, so the comparison uses the same files. */
  sourceIds: string[];
  /** A pasted chat reply. */
  reply: string | null;
  /** Files read from an agent's output folder, by path relative to output/. */
  files: { path: string; data: Blob }[] | null;
  /** The agent's REPORT.md, when the output folder had one. */
  report: string | null;
}

/** The parts of the workspace that are saved on the device and in exports. */
export interface WorkspaceData {
  mode: Mode;
  sources: TextSource[];
  projects: TextProject[];
  selectedSourceId: string | null;
  job: RewriteJob;
  textDestination: DestinationId;
  scope: Scope;
  stepByStep: boolean;
  stageReplies: StageReplies;
  textResult: TextResult | null;
  images: ImageSource[];
  selectedImageId: string | null;
  imageDefaults: ImageSettings;
  imageDestination: DestinationId;
  /** Images generated elsewhere and dropped back in, by source image id. */
  imageResults: Record<string, Blob>;
}

export interface Notice {
  id: number;
  tone: "info" | "error";
  text: string;
}

interface WorkspaceState extends WorkspaceData {
  /** Files that couldn't be added, from the most recent add. */
  rejected: Rejection[];
  notices: Notice[];
  busy: string | null;

  setMode(mode: Mode): void;
  addText(sources: TextSource[], projects: TextProject[], rejected: Rejection[]): void;
  updateSource(id: string, patch: Partial<TextSource>): void;
  removeSource(id: string): void;
  removeProject(id: string): void;
  setProjectIncluded(projectId: string, included: boolean): void;
  selectSource(id: string | null): void;
  setJob(patch: Partial<RewriteJob>): void;
  setGoal(goal: Goal): void;
  setTextDestination(id: DestinationId): void;
  setScope(scope: Scope): void;
  setStepByStep(on: boolean): void;
  setStageReply(stage: Exclude<Stage, "final">, reply: string): void;
  setTextResult(result: TextResult | null): void;

  addImages(images: ImageSource[], rejected: Rejection[]): void;
  updateImage(id: string, patch: Partial<ImageSource>): void;
  removeImage(id: string): void;
  selectImage(id: string | null): void;
  setImageDefaults(patch: Partial<ImageSettings>): void;
  setImageDestination(id: DestinationId): void;
  setImageResult(id: string, image: Blob | null): void;

  setBusy(label: string | null): void;
  notify(text: string, tone?: Notice["tone"]): void;
  dismissNotice(id: number): void;
  dismissRejected(): void;
  clearText(): void;
  clearImages(): void;
  replace(data: WorkspaceData): void;
}

export const EMPTY_WORKSPACE: Readonly<WorkspaceData> = Object.freeze({
  mode: "text",
  sources: [],
  projects: [],
  selectedSourceId: null,
  job: DEFAULT_JOB,
  textDestination: DEFAULT_TEXT_DESTINATION,
  scope: "all",
  stepByStep: false,
  stageReplies: {},
  textResult: null,
  images: [],
  selectedImageId: null,
  imageDefaults: DEFAULT_IMAGE_SETTINGS,
  imageDestination: DEFAULT_IMAGE_DESTINATION,
  imageResults: {},
});

let nextNoticeId = 1;

/** Clearing the text side also drops hand-off progress that referred to it. */
const resetProgress = { stageReplies: {}, textResult: null } as const;

export const useWorkspace = create<WorkspaceState>()((set) => ({
  ...EMPTY_WORKSPACE,
  rejected: [],
  notices: [],
  busy: null,

  setMode: (mode) => set({ mode }),

  addText: (sources, projects, rejected) =>
    set((state) => {
      const known = new Set(state.sources.map((source) => `${source.projectId}:${source.sha256}`));
      const fresh = sources.filter((source) => !known.has(`${source.projectId}:${source.sha256}`));
      const duplicates = sources.length - fresh.length;
      return {
        sources: [...state.sources, ...fresh],
        projects: [...state.projects, ...projects],
        selectedSourceId: state.selectedSourceId ?? fresh[0]?.id ?? null,
        rejected:
          duplicates > 0
            ? [
                ...rejected,
                {
                  name: duplicates === 1 ? "1 file" : `${duplicates} files`,
                  reason: "Already in your workspace.",
                },
              ]
            : rejected,
      };
    }),

  updateSource: (id, patch) =>
    set((state) => ({
      sources: state.sources.map((source) => (source.id === id ? { ...source, ...patch } : source)),
    })),

  removeSource: (id) =>
    set((state) => {
      const sources = state.sources.filter((source) => source.id !== id);
      return {
        sources,
        selectedSourceId:
          state.selectedSourceId === id ? (sources[0]?.id ?? null) : state.selectedSourceId,
      };
    }),

  removeProject: (projectId) =>
    set((state) => {
      const sources = state.sources.filter((source) => source.projectId !== projectId);
      const selectedGone = !sources.some((source) => source.id === state.selectedSourceId);
      return {
        sources,
        projects: state.projects.filter((project) => project.id !== projectId),
        selectedSourceId: selectedGone ? (sources[0]?.id ?? null) : state.selectedSourceId,
      };
    }),

  setProjectIncluded: (projectId, included) =>
    set((state) => ({
      sources: state.sources.map((source) =>
        source.projectId === projectId ? { ...source, included } : source,
      ),
    })),

  selectSource: (id) => set({ selectedSourceId: id }),
  setJob: (patch) =>
    set((state) => {
      // Choosing a tone or formality by hand turns the goal preset into a custom one.
      const changesStyle = "tone" in patch || "formality" in patch;
      return { job: { ...state.job, ...patch, goal: changesStyle ? "custom" : state.job.goal } };
    }),
  setGoal: (goal) => set((state) => ({ job: withGoal(state.job, goal) })),
  setTextDestination: (textDestination) => set({ textDestination }),
  setScope: (scope) => set({ scope }),
  setStepByStep: (stepByStep) => set({ stepByStep }),
  setStageReply: (stage, reply) =>
    set((state) => {
      // A changed earlier reply invalidates every later one.
      const order: Exclude<Stage, "final">[] = ["decompose", "rewrite", "verify"];
      const stageReplies: StageReplies = {};
      for (const earlier of order) {
        if (earlier === stage) {
          stageReplies[earlier] = reply;
          break;
        }
        stageReplies[earlier] = state.stageReplies[earlier];
      }
      return { stageReplies };
    }),
  setTextResult: (textResult) => set({ textResult }),

  addImages: (images, rejected) =>
    set((state) => {
      const known = new Set(state.images.map((image) => image.sha256));
      const fresh = images.filter((image) => !known.has(image.sha256));
      const duplicates = images.length - fresh.length;
      return {
        images: [...state.images, ...fresh],
        selectedImageId: state.selectedImageId ?? fresh[0]?.id ?? null,
        rejected:
          duplicates > 0
            ? [
                ...rejected,
                {
                  name: duplicates === 1 ? "1 image" : `${duplicates} images`,
                  reason: "Already in your workspace.",
                },
              ]
            : rejected,
      };
    }),

  updateImage: (id, patch) =>
    set((state) => ({
      images: state.images.map((image) => (image.id === id ? { ...image, ...patch } : image)),
    })),

  removeImage: (id) =>
    set((state) => {
      const images = state.images.filter((image) => image.id !== id);
      const imageResults = { ...state.imageResults };
      delete imageResults[id];
      return {
        images,
        imageResults,
        selectedImageId:
          state.selectedImageId === id ? (images[0]?.id ?? null) : state.selectedImageId,
      };
    }),

  selectImage: (id) => set({ selectedImageId: id }),
  setImageDefaults: (patch) =>
    set((state) => ({ imageDefaults: { ...state.imageDefaults, ...patch } })),
  setImageDestination: (imageDestination) => set({ imageDestination }),
  setImageResult: (id, image) =>
    set((state) => {
      const imageResults = { ...state.imageResults };
      if (image) imageResults[id] = image;
      else delete imageResults[id];
      return { imageResults };
    }),

  setBusy: (busy) => set({ busy }),
  notify: (text, tone = "info") =>
    set((state) => ({ notices: [...state.notices, { id: nextNoticeId++, tone, text }] })),
  dismissNotice: (id) =>
    set((state) => ({ notices: state.notices.filter((notice) => notice.id !== id) })),
  dismissRejected: () => set({ rejected: [] }),
  clearText: () =>
    set({
      sources: [],
      projects: [],
      selectedSourceId: null,
      ...resetProgress,
    }),
  clearImages: () => set({ images: [], selectedImageId: null, imageResults: {} }),
  replace: (data) => set({ ...EMPTY_WORKSPACE, ...data, rejected: [], busy: null }),
}));

export function workspaceData(state: WorkspaceData): WorkspaceData {
  return {
    mode: state.mode,
    sources: state.sources,
    projects: state.projects,
    selectedSourceId: state.selectedSourceId,
    job: state.job,
    textDestination: state.textDestination,
    scope: state.scope,
    stepByStep: state.stepByStep,
    stageReplies: state.stageReplies,
    textResult: state.textResult,
    images: state.images,
    selectedImageId: state.selectedImageId,
    imageDefaults: state.imageDefaults,
    imageDestination: state.imageDestination,
    imageResults: state.imageResults,
  };
}

export function hasWork(state: WorkspaceData): boolean {
  return state.sources.length > 0 || state.images.length > 0;
}
