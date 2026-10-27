import { useWorkspaceState } from "../../workspace/Workspace";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  assessContext,
  CURATED_MODEL_PROFILES,
  DEFAULT_EXTRACTION_OPTIONS,
  DEFAULT_MODEL_PROFILE_ID,
  DEFAULT_SETTINGS,
  extractFile,
  FileExtractionError,
  hashBytes,
  MAX_FILE_BYTES,
  MAX_FILE_COUNT,
  MAX_TOTAL_BYTES,
  preflightFiles,
  resolveSettings,
  type DocumentFormat,
  type ExtractionResult,
  type ModelProfile,
  type RewriteSettings,
} from "../../domain";
import {
  buildPromptPackage,
  initiatePromptPackageDownload,
  type ExportDocumentInput,
  type PromptPackageResult,
} from "../../export";
import { renderPromptBundle } from "../../prompting";
import { classifyStandaloneTextName } from "../../domain/sourceText";
import { STUDIO_EXAMPLES, type StudioExample } from "./studioExamples";

export type StudioDocumentStatus = "ready" | "review" | "error" | "loading";
export type StudioBuiltPackage = Extract<PromptPackageResult, { ok: true }>;
export interface StudioBuiltSource {
  readonly text: string;
  readonly isExample: boolean;
  readonly name: string;
}
export type StudioBuiltSourceIndex = Readonly<
  Record<string, StudioBuiltSource>
>;
const EMPTY_BUILT_SOURCES: StudioBuiltSourceIndex = Object.freeze({});

export interface StudioDocument {
  id: string;
  name: string;
  text: string;
  originalText: string;
  status: StudioDocumentStatus;
  error?: string;
  isExample?: boolean;
  format: DocumentFormat;
  warnings: string[];
  pageCount?: number | null;
  contextWarningAcknowledged: boolean;
  /** The uploaded File is retained unchanged, independently of the review editor. */
  original: File;
  extraction?: ExtractionResult;
}

interface StudioState {
  documents: StudioDocument[];
  selectedId: string | null;
  settings: RewriteSettings;
  profileId: string;
  builtPackage: StudioBuiltPackage | null;
  builtSourceByKey: StudioBuiltSourceIndex;
  retainedPackage: StudioBuiltPackage | null;
  retainedSourceByKey: StudioBuiltSourceIndex;
  packageGeneration: number;
  building: boolean;
  error: string | null;
  lastRemovedDocument: StudioDocument | null;
  lastRemovedIndex: number;
}

const profiles: readonly Readonly<ModelProfile>[] = CURATED_MODEL_PROFILES;
const studioFormats = { test: (name: string) => /\.(docx|pdf)$/i.test(name) || Boolean(classifyStandaloneTextName(name)) };

function createId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `studio-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function exampleDocument(example: StudioExample): StudioDocument {
  const format = example.name.endsWith(".txt") ? "text" : "markdown";
  return {
    id: `example-${example.id}`,
    name: example.name,
    text: example.text,
    originalText: example.text,
    status: "ready",
    isExample: true,
    format,
    warnings: [
      "Sample document: fictional source material provided for demonstration.",
    ],
    contextWarningAcknowledged: false,
    original: new File([example.text], example.name, {
      type: format === "text" ? "text/plain" : "text/markdown",
    }),
  };
}

function initialState(): StudioState {
  const initial = exampleDocument(STUDIO_EXAMPLES[0]);
  return {
    documents: [initial],
    selectedId: initial.id,
    settings: {
      ...DEFAULT_SETTINGS,
      tone: "plain",
      length: "concise",
      formality: "standard",
    },
    profileId: DEFAULT_MODEL_PROFILE_ID,
    builtPackage: null,
    builtSourceByKey: EMPTY_BUILT_SOURCES,
    retainedPackage: null,
    retainedSourceByKey: EMPTY_BUILT_SOURCES,
    packageGeneration: 0,
    building: false,
    error: null,
    lastRemovedDocument: null,
    lastRemovedIndex: 0,
  };
}

function workingProfile(state: StudioState): ModelProfile {
  return (
    profiles.find((candidate) => candidate.id === state.profileId) ??
    profiles.find((candidate) => candidate.id === DEFAULT_MODEL_PROFILE_ID)!
  );
}

function sourceContext(document: StudioDocument) {
  return {
    format: document.format,
    assets: (document.extraction?.visualAssets ?? []).map((asset) => ({
      id: asset.id,
      filename: asset.filename,
      mimeType: asset.mimeType,
      ...(asset.pageNumber ? { pageNumber: asset.pageNumber } : {}),
      ...(asset.sourcePath ? { sourcePath: asset.sourcePath } : {}),
      ...(asset.caption ? { caption: asset.caption } : {}),
      ...(asset.altText ? { altText: asset.altText } : {}),
      included: asset.included,
    })),
  };
}

function blockerFor(state: StudioState): string | null {
  if (state.documents.length === 0)
    return "Add a document or try an example to build your kit.";
  try {
    resolveSettings(state.settings);
  } catch (error) {
    return error instanceof Error && error.name === "SettingsValidationError"
      ? error.message
      : "Check your rewrite settings before building.";
  }
  for (const document of state.documents) {
    if (document.status === "loading")
      return `“${document.name}” is still being read.`;
    if (document.status === "error")
      return `Remove “${document.name}” or import a readable version before building.`;
    if (!document.text.trim())
      return `Add some source text to “${document.name}” before building.`;
    if (document.status === "review")
      return `Review and confirm “${document.name}” before building.`;
    if (
      assessContext(document.text, workingProfile(state).contextWindowTokens)
        .acknowledgmentRequired &&
      !document.contextWarningAcknowledged
    ) {
      return `“${document.name}” exceeds this model profile’s estimated workflow limit. Review the context warning before building.`;
    }
  }
  return null;
}

function capacityError(
  documents: readonly StudioDocument[],
  document: StudioDocument,
): string | null {
  const totalBytes = documents.reduce(
    (total, item) => total + item.original.size,
    0,
  );
  return documents.length >= MAX_FILE_COUNT
    ? "Your workspace can hold up to 20 documents. Remove one to add another."
    : document.original.size > MAX_FILE_BYTES
      ? "Each file must be 20 MB or smaller."
      : totalBytes + document.original.size > MAX_TOTAL_BYTES
        ? "The workspace has a 100 MB source-file limit. Remove a document to make room."
        : null;
}

async function sourceIndexFor(
  result: StudioBuiltPackage,
  sources: readonly { input: ExportDocumentInput; isExample: boolean }[],
): Promise<StudioBuiltSourceIndex> {
  const encoder = new TextEncoder();
  const snapshots = await Promise.all(
    sources.map(async ({ input, isExample }) => ({
      name: input.documentName,
      text: input.reviewedExtractedText,
      isExample,
      prompt: input.promptBundle.oneShot,
      reviewedHash: await hashBytes(
        encoder.encode(input.reviewedExtractedText).buffer,
      ),
    })),
  );
  return Object.freeze(
    Object.fromEntries(
      result.workbooks.map((workbook) => {
        const record = result.manifest.documents.find(
          (document) => document.key === workbook.documentKey,
        );
        const matches = snapshots.filter(
          (source) =>
            record &&
            source.name === record.originalDisplayName &&
            source.name === workbook.originalDisplayName &&
            source.reviewedHash === record.reviewedExtraction.sha256 &&
            source.prompt === workbook.promptBundle.oneShot,
        );
        const source = matches[0];
        if (
          !source ||
          matches.some((candidate) => candidate.text !== source.text)
        ) {
          throw new Error(
            "A generated workbook could not be matched to its reviewed source.",
          );
        }
        return [
          workbook.documentKey,
          Object.freeze({
            name: source.name,
            text: source.text,
            // An identical user upload must never inherit a sample-only classification.
            isExample: matches.every((candidate) => candidate.isExample),
          }),
        ];
      }),
    ),
  );
}

/** Browser-local workspace; optional recovery is managed by the workspace provider. */
export function useStudio() {
  const [state, setState] = useWorkspaceState<StudioState>("studio", initialState);
  const stateRef = useRef(state);
  const revisionRef = useRef(0);
  const intakeQueue = useRef<Promise<void>>(Promise.resolve());
  const controllers = useRef(new Map<string, AbortController>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const activeControllers = controllers.current;
    return () => {
      mounted.current = false;
      for (const controller of activeControllers.values()) controller.abort();
      activeControllers.clear();
    };
  }, []);

  // Events update the ref synchronously so rapid imports/edits cannot race a render.
  const commit = useCallback(
    (change: (previous: StudioState) => StudioState, invalidate = false) => {
      if (!mounted.current) return;
      const next = change(stateRef.current);
      if (invalidate) {
        revisionRef.current += 1;
        next.builtPackage = null;
        next.builtSourceByKey = EMPTY_BUILT_SOURCES;
        next.building = false;
      }
      stateRef.current = next;
      setState(next);
    },
    [setState],
  );

  const clearError = useCallback(
    () => commit((previous) => ({ ...previous, error: null })),
    [commit],
  );

  const selectDocument = useCallback(
    (id: string) => {
      if (stateRef.current.documents.some((document) => document.id === id)) {
        commit((previous) => ({ ...previous, selectedId: id }));
      }
    },
    [commit],
  );

  const updateText = useCallback(
    (text: string) => {
      const selectedId = stateRef.current.selectedId;
      const selected = stateRef.current.documents.find(
        (document) => document.id === selectedId,
      );
      if (
        !selected ||
        selected.status === "loading" ||
        selected.status === "error" ||
        selected.text === text
      )
        return;
      if (new TextEncoder().encode(text).byteLength > MAX_FILE_BYTES) {
        commit((previous) => ({
          ...previous,
          error: "Source text must be 20 MB or smaller.",
        }));
        return;
      }
      commit(
        (previous) => ({
          ...previous,
          error: null,
          documents: previous.documents.map((document) =>
            document.id === selectedId
              ? {
                  ...document,
                  text,
                  status: "review",
                  contextWarningAcknowledged: false,
                }
              : document,
          ),
        }),
        true,
      );
    },
    [commit],
  );

  const admitDocument = useCallback(
    (document: StudioDocument): boolean => {
      const current = stateRef.current;
      const error = capacityError(current.documents, document);
      if (error) {
        commit((previous) => ({ ...previous, error }));
        return false;
      }
      commit(
        (previous) => ({
          ...previous,
          documents: [...previous.documents, document],
          selectedId: document.id,
          error: null,
        }),
        true,
      );
      return true;
    },
    [commit],
  );

  const addTextDocument = useCallback(
    (text: string, name = "Untitled draft.txt") => {
      const cleanName = name.trim() || "Untitled draft.txt";
      const filename = /\.(txt|md|markdown)$/i.test(cleanName)
        ? cleanName
        : `${cleanName}.txt`;
      const format = /\.(md|markdown)$/i.test(filename) ? "markdown" : "text";
      const document: StudioDocument = {
        id: createId(),
        name: filename,
        text,
        originalText: text,
        status: "review",
        format,
        warnings: [],
        contextWarningAcknowledged: false,
        original: new File([text], filename, {
          type: format === "markdown" ? "text/markdown" : "text/plain",
        }),
      };
      return admitDocument(document) ? document.id : null;
    },
    [admitDocument],
  );

  const loadExample = useCallback(
    (id = STUDIO_EXAMPLES[0].id) => {
      const example = STUDIO_EXAMPLES.find((candidate) => candidate.id === id);
      if (!example) return;
      const existing = stateRef.current.documents.find(
        (document) => document.id === `example-${id}`,
      );
      if (existing) selectDocument(existing.id);
      else admitDocument(exampleDocument(example));
    },
    [admitDocument, selectDocument],
  );

  const importFiles = useCallback(
    (files: File[]): Promise<void> => {
      const incoming = [...files];
      const run = async () => {
        if (!incoming.length || !mounted.current) return;
        const supported = incoming.filter((file) =>
          studioFormats.test(file.name),
        );
        const issues = incoming
          .filter((file) => !studioFormats.test(file.name))
          .map(
            (file) =>
              `${file.name}: Choose a document or supported code/structured text file. Use Projects for folders and ZIPs.`,
          );
        const current = stateRef.current;
        const preflight = await preflightFiles(supported, {
          acceptedCount: current.documents.length,
          acceptedBytes: current.documents.reduce(
            (total, document) => total + document.original.size,
            0,
          ),
        });
        if (!mounted.current) return;
        for (const accepted of preflight) {
          if (!accepted.accepted) {
            issues.push(`${accepted.file.name}: ${accepted.issue.message}`);
            continue;
          }
          const id = createId();
          const controller = new AbortController();
          const document: StudioDocument = {
            id,
            name: accepted.file.name,
            text: "",
            originalText: "",
            status: "loading",
            format: accepted.format,
            warnings: [],
            contextWarningAcknowledged: false,
            original: accepted.file,
          };
          if (!admitDocument(document)) continue;
          controllers.current.set(id, controller);
          try {
            const extraction = await extractFile(accepted, {
              options: { ...DEFAULT_EXTRACTION_OPTIONS },
              existingDocuments: stateRef.current.documents.flatMap((item) =>
                item.extraction
                  ? [
                      {
                        id: item.id,
                        originalHash: item.extraction.originalHash,
                      },
                    ]
                  : [],
              ),
              signal: controller.signal,
            });
            if (
              controller.signal.aborted ||
              !mounted.current ||
              controllers.current.get(id) !== controller ||
              !stateRef.current.documents.some(
                (item) => item.id === id && item.status === "loading",
              )
            )
              continue;
            commit(
              (previous) => ({
                ...previous,
                documents: previous.documents.map((item) =>
                  item.id === id
                    ? {
                        ...item,
                        text: extraction.extractedText,
                        originalText: extraction.extractedText,
                        status: "review",
                        warnings: extraction.warnings,
                        pageCount: extraction.pageCount,
                        extraction,
                      }
                    : item,
                ),
              }),
              true,
            );
          } catch (error) {
            if (controller.signal.aborted || !mounted.current) continue;
            const message =
              error instanceof FileExtractionError
                ? error.issue.message
                : "This file could not be read. Try exporting it as a TXT or Markdown file.";
            commit(
              (previous) => ({
                ...previous,
                documents: previous.documents.map((item) =>
                  item.id === id
                    ? { ...item, status: "error", error: message }
                    : item,
                ),
              }),
              true,
            );
          } finally {
            controllers.current.delete(id);
          }
        }
        if (issues.length)
          commit((previous) => ({ ...previous, error: issues.join("\n") }));
      };
      const operation = intakeQueue.current.then(run).catch(() => {
        commit((previous) => ({
          ...previous,
          error:
            "The files could not be imported. Your existing documents are still available.",
        }));
      });
      intakeQueue.current = operation;
      return operation;
    },
    [admitDocument, commit],
  );

  const removeDocument = useCallback(
    (id: string) => {
      const index = stateRef.current.documents.findIndex(
        (document) => document.id === id,
      );
      if (index < 0) return;
      const removed = stateRef.current.documents[index];
      controllers.current.get(id)?.abort();
      controllers.current.delete(id);
      commit((previous) => {
        const documents = previous.documents.filter(
          (document) => document.id !== id,
        );
        return {
          ...previous,
          documents,
          selectedId:
            previous.selectedId === id
              ? (documents[0]?.id ?? null)
              : previous.selectedId,
          error: null,
          lastRemovedDocument: removed.status === "loading" ? null : removed,
          lastRemovedIndex: index,
        };
      }, true);
    },
    [commit],
  );

  const restoreRemovedDocument = useCallback((): boolean => {
    const current = stateRef.current;
    const removed = current.lastRemovedDocument;
    if (!removed) return false;
    // Reloading an example may already have reused its stable ID; never replace it.
    if (current.documents.some((document) => document.id === removed.id)) {
      commit((previous) => ({
        ...previous,
        selectedId: removed.id,
        lastRemovedDocument: null,
      }));
      return false;
    }
    const error = capacityError(current.documents, removed);
    if (error) {
      commit((previous) => ({
        ...previous,
        error: `Unable to undo removal. ${error}`,
      }));
      return false;
    }
    commit((previous) => {
      const documents = [...previous.documents];
      documents.splice(
        Math.min(previous.lastRemovedIndex, documents.length),
        0,
        removed,
      );
      return {
        ...previous,
        documents,
        selectedId: removed.id,
        lastRemovedDocument: null,
        error: null,
      };
    }, true);
    return true;
  }, [commit]);

  const confirmReview = useCallback(() => {
    const selected = stateRef.current.documents.find(
      (document) => document.id === stateRef.current.selectedId,
    );
    if (
      !selected ||
      selected.status === "loading" ||
      selected.status === "error"
    )
      return;
    if (!selected.text.trim()) {
      commit((previous) => ({
        ...previous,
        error: "Add some source text before confirming this document.",
      }));
      return;
    }
    commit(
      (previous) => ({
        ...previous,
        error: null,
        documents: previous.documents.map((document) =>
          document.id === selected.id
            ? { ...document, status: "ready" }
            : document,
        ),
      }),
      true,
    );
  }, [commit]);

  const updateSettings = useCallback(
    (patch: Partial<RewriteSettings>) => {
      // Keep the editing value intact, including temporarily empty fields and spaces.
      if (
        Object.entries(patch).every(
          ([key, value]) =>
            stateRef.current.settings[key as keyof RewriteSettings] === value,
        )
      )
        return;
      commit(
        (previous) => ({
          ...previous,
          settings: { ...previous.settings, ...patch },
          error: null,
        }),
        true,
      );
    },
    [commit],
  );

  const selectProfile = useCallback(
    (id: string) => {
      if (stateRef.current.profileId === id) return;
      if (!profiles.some((candidate) => candidate.id === id)) return;
      commit(
        (previous) => ({
          ...previous,
          profileId: id,
          error: null,
          documents: previous.documents.map((document) => ({
            ...document,
            contextWarningAcknowledged: false,
          })),
          lastRemovedDocument: previous.lastRemovedDocument
            ? {
                ...previous.lastRemovedDocument,
                contextWarningAcknowledged: false,
              }
            : null,
        }),
        true,
      );
    },
    [commit],
  );

  const acknowledgeContextWarning = useCallback(() => {
    const selectedId = stateRef.current.selectedId;
    commit(
      (previous) => ({
        ...previous,
        error: null,
        documents: previous.documents.map((document) =>
          document.id === selectedId
            ? { ...document, contextWarningAcknowledged: true }
            : document,
        ),
      }),
      true,
    );
  }, [commit]);

  const buildPackage = useCallback(async (): Promise<void> => {
    const snapshot = stateRef.current;
    if (snapshot.building) return;
    const blocker = blockerFor(snapshot);
    if (blocker) {
      commit((previous) => ({ ...previous, error: blocker }));
      return;
    }
    const revision = revisionRef.current;
    commit((previous) => ({ ...previous, building: true, error: null }));
    try {
      const settings = resolveSettings(snapshot.settings);
      const profile = workingProfile(snapshot);
      const inputs: ExportDocumentInput[] = snapshot.documents.map(
        (document, uploadOrdinal) => ({
          kind: "document",
          documentId: document.id,
          documentName: document.name,
          documentFormat: document.format,
          original: document.original,
          reviewedExtractedText: document.text,
          resolvedSettings: settings,
          chosenProfile: profile,
          promptBundle: renderPromptBundle(
            document.text,
            settings,
            profile,
            sourceContext(document),
          ),
          warnings: [...document.warnings],
          contextAssessment: assessContext(
            document.text,
            profile.contextWindowTokens,
          ),
          reviewed: document.status === "ready",
          contextWarningAcknowledged: document.contextWarningAcknowledged,
          uploadOrdinal,
          pageCount: document.pageCount ?? null,
          extractionOptions:
            document.extraction?.extractionOptions ??
            DEFAULT_EXTRACTION_OPTIONS,
          visualAssets: document.extraction?.visualAssets ?? [],
          ocrCandidates: document.extraction?.ocrCandidates ?? [],
        }),
      );
      const result = await buildPromptPackage(inputs);
      if (!mounted.current || revision !== revisionRef.current) return;
      // Export order is canonical, independent of the workspace's upload order.
      const builtSourceByKey = result.ok
        ? await sourceIndexFor(
            result,
            inputs.map((input, index) => ({
              input,
              isExample: snapshot.documents[index].isExample === true,
            })),
          )
        : EMPTY_BUILT_SOURCES;
      if (!mounted.current || revision !== revisionRef.current) return;
      commit((previous) => ({
        ...previous,
        building: false,
        builtPackage: result.ok ? result : null,
        builtSourceByKey,
        retainedPackage: result.ok ? result : previous.retainedPackage,
        retainedSourceByKey: result.ok
          ? builtSourceByKey
          : previous.retainedSourceByKey,
        packageGeneration: result.ok
          ? previous.packageGeneration + 1
          : previous.packageGeneration,
        error: result.ok ? null : result.error.message,
      }));
    } catch (error) {
      if (!mounted.current || revision !== revisionRef.current) return;
      commit((previous) => ({
        ...previous,
        building: false,
        builtPackage: null,
        builtSourceByKey: EMPTY_BUILT_SOURCES,
        error:
          error instanceof Error && error.name === "SettingsValidationError"
            ? error.message
            : "Your kit could not be built. Your documents are still available; please try again.",
      }));
    }
  }, [commit]);

  const downloadPackage = useCallback(() => {
    const builtPackage =
      stateRef.current.builtPackage ?? stateRef.current.retainedPackage;
    if (!builtPackage) return;
    const result = initiatePromptPackageDownload(builtPackage.blob);
    if (!result.ok)
      commit((previous) => ({ ...previous, error: result.error.message }));
  }, [commit]);

  const selectedDocument =
    state.documents.find((document) => document.id === state.selectedId) ??
    null;
  const profile = workingProfile(state);
  const contextAssessment = useMemo(
    () =>
      assessContext(selectedDocument?.text ?? "", profile.contextWindowTokens),
    [selectedDocument?.text, profile.contextWindowTokens],
  );
  const promptBundle = useMemo(() => {
    if (!selectedDocument) return null;
    try {
      const settings = resolveSettings(state.settings);
      return renderPromptBundle(
        selectedDocument.text,
        settings,
        profile,
        sourceContext(selectedDocument),
      );
    } catch {
      // A partially edited form must never tear down the in-memory document session.
      return null;
    }
  }, [selectedDocument, state.settings, profile]);

  return {
    documents: state.documents,
    selectedId: state.selectedId,
    selectedDocument,
    selectDocument,
    updateText,
    importFiles,
    addTextDocument,
    loadExample,
    removeDocument,
    lastRemovedDocument: state.lastRemovedDocument,
    canUndoRemove: state.lastRemovedDocument !== null,
    restoreRemovedDocument,
    confirmReview,
    settings: state.settings,
    updateSettings,
    profile,
    profiles,
    selectProfile,
    buildPackage,
    building: state.building,
    builtPackage: state.builtPackage,
    builtSourceByKey: state.builtSourceByKey,
    retainedPackage: state.retainedPackage,
    retainedSourceByKey: state.retainedSourceByKey,
    packageGeneration: state.packageGeneration,
    downloadPackage,
    error: state.error,
    clearError,
    contextAssessment,
    contextWarningAcknowledged:
      selectedDocument?.contextWarningAcknowledged ?? false,
    acknowledgeContextWarning,
    promptBundle,
    exportBlocker: blockerFor(state),
    examples: STUDIO_EXAMPLES,
  };
}

export type Studio = ReturnType<typeof useStudio>;
