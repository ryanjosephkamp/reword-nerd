import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { ModalShell } from "../../app/workbench/components/ModalShell";
import type { ImageInputFile } from "../intake";
import { CURRENT_IMAGE_TUTORIAL_VERSION } from "../preferences";
import { shareImageCanonicalUrl } from "../share";
import { ImageDialogs } from "./ImageDialogs";
import { ImageBuildDock } from "./ImageBuildDock";
import { ImageHeader } from "./ImageHeader";
import { ImageMobileTabs } from "./ImageMobileTabs";
import { ImagePdfCaptureDialog } from "./ImagePdfCaptureDialog";
import { ImagePackagePreview } from "./ImagePackagePreview";
import { ImagePreviewPanel } from "./ImagePreviewPanel";
import { ImageQueuePanel } from "./ImageQueuePanel";
import { ImageSettingsPanel } from "./ImageSettingsPanel";
import type { ImageMobileTab } from "./contracts";
import { defaultImageWorkbenchServices, type ImageWorkbenchServices } from "./services";
import { useImageSession } from "./useImageSession";
import { useImageResponsiveMode } from "./useImageResponsiveMode";

export function ImageWorkbench({
  services = defaultImageWorkbenchServices,
}: {
  services?: ImageWorkbenchServices;
}) {
  const session = useImageSession(services);
  const [activeTab, setActiveTab] = useState<ImageMobileTab>("images");
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false);
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [shareFallbackOpen, setShareFallbackOpen] = useState(false);
  const [shareMessage, setShareMessage] = useState("");
  const [removeItemIds, setRemoveItemIds] = useState<readonly string[]>([]);
  const helpReturnFocusRef = useRef<HTMLButtonElement>(null);
  const infoReturnFocusRef = useRef<HTMLButtonElement>(null);
  const shareReturnFocusRef = useRef<HTMLButtonElement>(null);
  const pdfCaptureReturnFocusRef = useRef<HTMLElement>(null);
  const previousPdfCaptureOpenRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const settingsDrawerOpenRef = useRef(false);
  const newSessionReturnFocusRef = useRef<HTMLButtonElement>(null);
  const removeReturnFocusRef = useRef<HTMLElement>(null);
  const queueHeadingRef = useRef<HTMLHeadingElement>(null);
  const postRemoveFocusRef = useRef<string | "queue-heading" | null>(null);
  const handleResponsiveModeChange = useCallback((nextMode: "desktop" | "tablet" | "mobile") => {
    if (nextMode === "tablet" || !settingsDrawerOpenRef.current) return;
    settingsDrawerOpenRef.current = false;
    setSettingsDrawerOpen(false);
    settingsButtonRef.current?.focus();
    queueMicrotask(() => settingsButtonRef.current?.focus());
  }, []);
  const responsiveMode = useImageResponsiveMode(handleResponsiveModeChange);

  useLayoutEffect(() => {
    const target = postRemoveFocusRef.current;
    if (target === null) return;
    postRemoveFocusRef.current = null;
    if (target === "queue-heading") queueHeadingRef.current?.focus();
    else document.getElementById(`image-focus-${target}`)?.focus();
  }, [session.state.items]);

  useLayoutEffect(() => {
    const open = session.pdfCapture !== null;
    if (open && !previousPdfCaptureOpenRef.current) {
      const active = document.activeElement;
      pdfCaptureReturnFocusRef.current = active instanceof HTMLElement && active !== document.body
        ? active
        : queueHeadingRef.current;
    }
    previousPdfCaptureOpenRef.current = open;
  }, [session.pdfCapture]);

  const completeTutorial = () => {
    session.dispatch({ type: "tutorial/seen", version: CURRENT_IMAGE_TUTORIAL_VERSION });
  };
  const share = () => {
    const active = document.activeElement;
    shareReturnFocusRef.current = active instanceof HTMLButtonElement
      ? active
      : document.querySelector<HTMLButtonElement>('.image-header-actions button[aria-label="Share"]');
    setShareMessage("");
    void shareImageCanonicalUrl().then((result) => {
      if (result === "shared") setShareMessage("Link shared.");
      else if (result === "copied") setShareMessage("Link copied.");
      else if (result === "manual") setShareFallbackOpen(true);
    });
  };
  const focusedItem = session.state.items.find((item) => item.id === session.state.focusedItemId) ?? null;
  const removeItems = removeItemIds.flatMap((id) => {
    const item = session.state.items.find((candidate) => candidate.id === id);
    return item ? [{ id: item.id, name: item.provenance.sourceName }] : [];
  });

  const settingsContent = <>
    <header><p className="image-eyebrow">PROMPT INTENT</p><h2>SETTINGS</h2></header>
    <ImageBuildDock
      state={session.state}
      dispatch={session.dispatch}
      buildPackage={session.buildPackage}
      downloadPackage={session.downloadPackage}
    />
    <ImageSettingsPanel
      key={session.state.sessionGeneration}
      state={session.state}
      focusedItem={focusedItem}
      dispatch={session.dispatch}
    />
  </>;

  return <main
    className="image-workbench"
    aria-label="reword_nerd Image workbench"
    data-responsive-mode={responsiveMode}
  >
    <ImageHeader
      ref={settingsButtonRef}
      hasSessionWork={session.state.items.length > 0 || session.intakeBusy || session.pdfCapture !== null}
      settingsExpanded={responsiveMode === "tablet" ? settingsDrawerOpen : undefined}
      onOpenFiles={() => fileInputRef.current?.click()}
      onNewSession={(button) => {
        newSessionReturnFocusRef.current = button;
        setNewSessionOpen(true);
      }}
      onOpenSettings={() => {
        if (responsiveMode === "tablet") {
          settingsDrawerOpenRef.current = true;
          setSettingsDrawerOpen(true);
        }
        else setActiveTab("settings");
      }}
      onOpenHelp={(button) => { helpReturnFocusRef.current = button; setHelpOpen(true); }}
      onOpenInfo={(button) => { infoReturnFocusRef.current = button; setInfoOpen(true); }}
      onShare={share}
      onClearSession={session.resetSession}
    />
    <ImageMobileTabs active={activeTab} onChange={setActiveTab} />
    <div className="image-workbench-grid">
      <section
        id="image-panel-images"
        className="image-panel image-queue-panel"
        role="region"
        aria-label="Image queue"
        data-active={activeTab === "images"}
      >
        <header><p className="image-eyebrow">IMAGE SET</p><h2 ref={queueHeadingRef} tabIndex={-1}>IMAGES</h2></header>
        <div
          className="image-intake-target"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            void session.intakeFiles([...event.dataTransfer.files] as ImageInputFile[]);
          }}
        >
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            aria-label="Add image files"
            multiple
            accept=".png,.jpg,.jpeg,.webp,.avif,.pdf,.docx,.zip"
            disabled={session.intakeBusy}
            onChange={(event) => {
              const files = [...(event.currentTarget.files ?? [])] as ImageInputFile[];
              event.currentTarget.value = "";
              void session.intakeFiles(files);
            }}
          />
          <input
            ref={folderInputRef}
            className="visually-hidden"
            type="file"
            aria-label="Add image folder"
            multiple
            {...({ webkitdirectory: "" } as Record<string, string>)}
            disabled={session.intakeBusy}
            onChange={(event) => {
              const files = [...(event.currentTarget.files ?? [])] as ImageInputFile[];
              event.currentTarget.value = "";
              void session.intakeFolder(files);
            }}
          />
          {session.state.items.length === 0
            ? <div className="image-empty-state"><p>No images in this local session.</p></div>
            : null}
          <div className="image-intake-actions">
            <button type="button" disabled={session.intakeBusy} onClick={() => fileInputRef.current?.click()}>ADD IMAGES</button>
            <button type="button" disabled={session.intakeBusy} onClick={() => folderInputRef.current?.click()}>ADD FOLDER</button>
          </div>
          {session.intakeBusy ? <p role="status" aria-live="polite">Reading local inputs…</p> : null}
          {session.ledger.length > 0 ? <ul aria-label="Image intake ledger">
            {session.ledger.map((entry, index) => <li key={`${entry.inputName}-${entry.path ?? "direct"}-${index}`}>
              {entry.path ?? entry.inputName} — {entry.status.toUpperCase()}
            </li>)}
          </ul> : null}
          {session.intakeIssues.length > 0 ? <div role="alert">
            {session.intakeIssues.map((issue, index) => <p key={`${issue.code}-${index}`}>{issue.message}</p>)}
          </div> : null}
        </div>
        <ImageQueuePanel
          items={session.state.items}
          focusedItemId={session.state.focusedItemId}
          thumbnailLeasesEnabled={responsiveMode !== "mobile" || activeTab === "images"}
          objectUrls={session.objectUrls}
          onFocus={(itemId) => session.dispatch({ type: "focus/changed", itemId })}
          onSelect={(itemId, selected) => session.dispatch({ type: "bulk/selection-changed", itemId, selected })}
          onInclusion={(itemId, included) => session.dispatch({ type: "item/inclusion-changed", itemId, included })}
          onRequestRemove={(itemIds, trigger) => {
            removeReturnFocusRef.current = trigger;
            setRemoveItemIds(itemIds);
          }}
          onRunOcr={(itemIds) => { void session.runOcr(itemIds); }}
        />
      </section>
      <section
        id="image-panel-preview"
        className="image-panel image-preview-panel"
        role="region"
        aria-label="Focused image preview"
        data-active={activeTab === "preview"}
      >
        <header><p className="image-eyebrow">FOCUSED SOURCE</p><h2>PREVIEW</h2></header>
        <ImagePreviewPanel
          item={focusedItem}
          objectUrls={session.objectUrls}
          leaseEnabled={responsiveMode !== "mobile" || activeTab === "preview"}
          onRunOcr={() => { if (focusedItem) void session.runOcr([focusedItem.id]); }}
          onReviewOcr={(status, reviewedText) => {
            if (focusedItem) session.reviewOcr(focusedItem.id, status, reviewedText);
          }}
        />
        {session.state.buildStatus === "ready" && session.state.builtOutput
          ? <ImagePackagePreview
              pairs={session.state.builtOutput.previewPairs}
              objectUrls={session.objectUrls}
              leaseEnabled={responsiveMode !== "mobile" || activeTab === "preview"}
              copyPrompt={services.copyPrompt}
              copyImage={services.copyImage}
            />
          : null}
      </section>
      {responsiveMode !== "tablet" ? <section
          id="image-panel-settings"
          className="image-panel image-settings-panel"
          role="region"
          aria-label="Image settings"
          data-active={activeTab === "settings"}
        >
          {settingsContent}
        </section> : null}
    </div>
    <ModalShell
      open={responsiveMode === "tablet" && settingsDrawerOpen}
      title="Image settings"
      closeLabel="Close Image settings"
      onDismiss={() => {
        settingsDrawerOpenRef.current = false;
        setSettingsDrawerOpen(false);
      }}
      returnFocusRef={settingsButtonRef}
      variant="drawer"
      className="image-settings-drawer"
      dialogId="image-settings-drawer"
    >
      <section id="image-panel-settings" aria-label="Image settings">
        {settingsContent}
      </section>
    </ModalShell>
    <ImageDialogs
      quickStartOpen={session.state.tutorialSeenVersion !== CURRENT_IMAGE_TUTORIAL_VERSION}
      helpOpen={helpOpen}
      infoOpen={infoOpen}
      shareFallbackOpen={shareFallbackOpen}
      newSessionOpen={newSessionOpen}
      removeItems={removeItems}
      helpReturnFocusRef={helpReturnFocusRef}
      infoReturnFocusRef={infoReturnFocusRef}
      shareReturnFocusRef={shareReturnFocusRef}
      newSessionReturnFocusRef={newSessionReturnFocusRef}
      removeReturnFocusRef={removeReturnFocusRef}
      onDismissQuickStart={completeTutorial}
      onDismissHelp={() => setHelpOpen(false)}
      onDismissInfo={() => setInfoOpen(false)}
      onDismissShare={() => setShareFallbackOpen(false)}
      onDismissNewSession={() => setNewSessionOpen(false)}
      onConfirmNewSession={() => {
        setNewSessionOpen(false);
        session.resetSession();
        newSessionReturnFocusRef.current?.focus();
        queueMicrotask(() => newSessionReturnFocusRef.current?.focus());
      }}
      onDismissRemove={() => setRemoveItemIds([])}
      onConfirmRemove={() => {
        const removed = new Set(removeItemIds);
        const survivingFocused = session.state.items.find((item) => item.id === session.state.focusedItemId && !removed.has(item.id));
        const survivor = survivingFocused ?? session.state.items.find((item) => !removed.has(item.id));
        postRemoveFocusRef.current = survivor?.id ?? "queue-heading";
        for (const id of removeItemIds) {
          const item = session.state.items.find((candidate) => candidate.id === id);
          if (item) session.discardItem(item);
        }
        setRemoveItemIds([]);
      }}
    />
    <ImagePdfCaptureDialog
      key={session.pdfCapture
        ? `${session.pdfCapture.inputName}:${session.pdfCapture.path ?? "direct"}:${session.pdfCapture.pageCount}`
        : "no-pdf-capture"}
      open={session.pdfCapture !== null}
      request={session.pdfCapture}
      returnFocusRef={pdfCaptureReturnFocusRef}
      onChoose={session.choosePdfCapture}
    />
    {shareMessage ? <p className="visually-hidden" role="status" aria-live="polite">{shareMessage}</p> : null}
  </main>;
}
