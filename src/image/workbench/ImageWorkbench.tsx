import { useRef, useState } from "react";
import { ModalShell } from "../../app/workbench/components/ModalShell";
import type { ImageInputFile } from "../intake";
import { CURRENT_IMAGE_TUTORIAL_VERSION } from "../preferences";
import { CANONICAL_IMAGE_URL, shareImageCanonicalUrl } from "../share";
import { ImageDialogs } from "./ImageDialogs";
import { ImageBuildDock } from "./ImageBuildDock";
import { ImageHeader } from "./ImageHeader";
import { ImageMobileTabs } from "./ImageMobileTabs";
import { ImagePdfCaptureDialog } from "./ImagePdfCaptureDialog";
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
  const responsiveMode = useImageResponsiveMode();
  const [activeTab, setActiveTab] = useState<ImageMobileTab>("images");
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [shareMessage, setShareMessage] = useState("");
  const [removeItemIds, setRemoveItemIds] = useState<readonly string[]>([]);
  const helpReturnFocusRef = useRef<HTMLButtonElement>(null);
  const infoReturnFocusRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);

  const completeTutorial = () => {
    session.dispatch({ type: "tutorial/seen", version: CURRENT_IMAGE_TUTORIAL_VERSION });
  };
  const share = () => {
    setShareMessage("");
    void shareImageCanonicalUrl().then((result) => {
      if (result === "shared") setShareMessage("Link shared.");
      else if (result === "copied") setShareMessage("Link copied.");
      else setShareMessage(`Copy ${CANONICAL_IMAGE_URL}`);
    });
  };
  const focusedItem = session.state.items.find((item) => item.id === session.state.focusedItemId) ?? null;
  const removeItems = removeItemIds.flatMap((id) => {
    const item = session.state.items.find((candidate) => candidate.id === id);
    return item ? [{ id: item.id, name: item.provenance.sourceName }] : [];
  });

  const settingsContent = <>
    <header><p className="image-eyebrow">PROMPT INTENT</p><h2>SETTINGS</h2></header>
    <ImageSettingsPanel
      key={session.state.sessionGeneration}
      state={session.state}
      focusedItem={focusedItem}
      dispatch={session.dispatch}
    />
    <ImageBuildDock state={session.state} dispatch={session.dispatch} />
  </>;

  return <main
    className="image-workbench"
    aria-label="reword_nerd Image workbench"
    data-responsive-mode={responsiveMode}
  >
    <ImageHeader
      ref={settingsButtonRef}
      hasSessionWork={session.state.items.length > 0 || session.intakeBusy || session.pdfCapture !== null}
      settingsExpanded={responsiveMode === "tablet" ? settingsDrawerOpen : activeTab === "settings"}
      onOpenFiles={() => fileInputRef.current?.click()}
      onNewSession={session.resetSession}
      onOpenSettings={() => {
        if (responsiveMode === "tablet") setSettingsDrawerOpen(true);
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
        <header><p className="image-eyebrow">IMAGE SET</p><h2>IMAGES</h2></header>
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
          onRequestRemove={setRemoveItemIds}
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
      onDismiss={() => setSettingsDrawerOpen(false)}
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
      removeItems={removeItems}
      helpReturnFocusRef={helpReturnFocusRef}
      infoReturnFocusRef={infoReturnFocusRef}
      onDismissQuickStart={completeTutorial}
      onDismissHelp={() => setHelpOpen(false)}
      onDismissInfo={() => setInfoOpen(false)}
      onDismissRemove={() => setRemoveItemIds([])}
      onConfirmRemove={() => {
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
      onChoose={session.choosePdfCapture}
    />
    {shareMessage ? <p className="visually-hidden" role="status" aria-live="polite">{shareMessage}</p> : null}
  </main>;
}
