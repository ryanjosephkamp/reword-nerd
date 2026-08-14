import { useEffect, useRef, type RefObject } from "react";
import { ModalShell } from "../../app/workbench/components/ModalShell";
import { COMMUNITY_LINKS, EXTERNAL_LINK_ATTRIBUTES } from "../../app/workbench/community";
import { CURRENT_RELEASE_POST_PATH } from "../../updates/currentRelease";
import { CANONICAL_IMAGE_URL } from "../share";

const artworkPath = `${import.meta.env.BASE_URL}image/orange-pyramid.webp`;

interface ImageDialogsProps {
  readonly quickStartOpen: boolean;
  readonly helpOpen: boolean;
  readonly infoOpen: boolean;
  readonly shareFallbackOpen: boolean;
  readonly newSessionOpen: boolean;
  readonly removeItems?: readonly Readonly<{ id: string; name: string }>[];
  readonly helpReturnFocusRef: RefObject<HTMLButtonElement | null>;
  readonly infoReturnFocusRef: RefObject<HTMLButtonElement | null>;
  readonly shareReturnFocusRef: RefObject<HTMLButtonElement | null>;
  readonly newSessionReturnFocusRef: RefObject<HTMLButtonElement | null>;
  readonly removeReturnFocusRef: RefObject<HTMLElement | null>;
  readonly onDismissQuickStart: () => void;
  readonly onDismissHelp: () => void;
  readonly onDismissInfo: () => void;
  readonly onDismissShare: () => void;
  readonly onDismissNewSession: () => void;
  readonly onConfirmNewSession: () => void;
  readonly onDismissRemove?: () => void;
  readonly onConfirmRemove?: () => void;
}

function restoreFocus(ref: RefObject<HTMLElement | null>): void {
  ref.current?.focus();
  queueMicrotask(() => ref.current?.focus());
}

export function ImageDialogs(props: ImageDialogsProps) {
  const shareUrlRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!props.shareFallbackOpen) return;
    shareUrlRef.current?.focus();
    shareUrlRef.current?.select();
  }, [props.shareFallbackOpen]);

  return <>
    <ModalShell
      open={props.quickStartOpen}
      title="Image Quick Start"
      closeLabel="Close Image Quick Start"
      onDismiss={props.onDismissQuickStart}
      className="image-quick-start-dialog"
    >
      <div className="image-dialog-artwork">
        <img src={artworkPath} width="112" height="112" alt="Orange pyramid artwork" />
        <div>
          <p><strong>Processing stays local in this browser. Direct image and recoverable DOCX media bytes may retain EXIF or location metadata. PDF visuals are locally rasterized PNG recovery output.</strong></p>
          <p>Each included image produces one source image and one prompt. Bulk masks require Apply, and OCR must be reviewed.</p>
          <p>Build creates one ZIP for the current confirmed image set in memory. Download becomes available only for that current Ready package.</p>
          <p>Changes cancel or clear stale package work. Building does not download automatically.</p>
          <p>No model runs and nothing uploads.</p>
        </div>
      </div>
      <div className="dialog-actions"><button type="button" data-image-start onClick={props.onDismissQuickStart}>START LOCAL SESSION</button></div>
    </ModalShell>

    <ModalShell
      open={props.newSessionOpen}
      title="Start a new Image session?"
      closeLabel="Cancel new Image session"
      onDismiss={props.onDismissNewSession}
      returnFocusRef={props.newSessionReturnFocusRef}
      className="image-new-session-dialog confirm-dialog"
      initialFocusSelector="[data-image-new-session]"
    >
      <p>This clears every local image occurrence, exact source byte, OCR review, selection, and setting in the current Image session.</p>
      <div className="dialog-actions">
        <button type="button" data-image-new-session className="danger-action" onClick={props.onConfirmNewSession}>CLEAR IMAGE SESSION</button>
        <button type="button" onClick={() => {
          props.onDismissNewSession();
          restoreFocus(props.newSessionReturnFocusRef);
        }}>CANCEL</button>
      </div>
    </ModalShell>

    <ModalShell
      open={props.helpOpen}
      title="Image Help"
      closeLabel="Close Image Help"
      onDismiss={props.onDismissHelp}
      returnFocusRef={props.helpReturnFocusRef}
      className="image-help-dialog"
    >
      <p>Processing stays local. Direct image and recoverable DOCX media bytes may retain EXIF or location metadata. PDF visuals are locally rasterized PNG recovery output.</p>
      <p>Use one source image and one prompt for each included image.</p>
      <p>Bulk masks change only checked fields after Apply.</p>
      <p>OCR text must be reviewed and accepted or rejected.</p>
      <p>BUILD PACKAGE creates the current confirmed set as one ZIP in memory. Building does not download automatically.</p>
      <p>DOWNLOAD ZIP is enabled only for the current Ready package.</p>
      <p>Changes invalidate confirmation and cancel or clear stale package work.</p>
      <p>No model runs, no credentials are used, and nothing uploads.</p>
    </ModalShell>

    <ModalShell
      open={props.infoOpen}
      title="About reword-nerd Image"
      closeLabel="Close Image info"
      onDismiss={props.onDismissInfo}
      returnFocusRef={props.infoReturnFocusRef}
      className="image-info-dialog"
    >
      <div className="image-dialog-artwork">
        <img src={artworkPath} width="96" height="96" alt="Orange pyramid artwork" />
        <p>Image is a local, browser-only workbench for preparing faithful-rendition prompts and provider run cards.</p>
      </div>
      <section className="info-group" aria-labelledby="image-info-product-heading">
        <h3 id="image-info-product-heading">Product</h3>
        <nav className="info-group-links" aria-label="Product links">
          <a href={CURRENT_RELEASE_POST_PATH}>Updates</a>
          <a href={COMMUNITY_LINKS.repository} {...EXTERNAL_LINK_ATTRIBUTES}>Repository</a>
        </nav>
      </section>
      <section className="info-group" aria-labelledby="image-info-community-heading">
        <h3 id="image-info-community-heading">Community</h3>
        <p>Issues are public. Use synthetic descriptions only; never attach images, packages, prompts, credentials, or confidential material.</p>
        <nav className="info-group-links" aria-label="Community links">
          <a href={COMMUNITY_LINKS.reportBug} {...EXTERNAL_LINK_ATTRIBUTES}>Report a bug</a>
          <a href={COMMUNITY_LINKS.suggestFeature} {...EXTERNAL_LINK_ATTRIBUTES}>Suggest a feature</a>
          <a href={COMMUNITY_LINKS.securityReporting} {...EXTERNAL_LINK_ATTRIBUTES}>Security reporting</a>
        </nav>
      </section>
      <section className="info-group info-creator" aria-labelledby="image-info-creator-heading">
        <h3 id="image-info-creator-heading">Creator</h3>
        <p>Built by Ryan Kamp. More projects, contact details, and ways to support independent work.</p>
        <nav className="info-group-links" aria-label="Creator links">
          <a href={COMMUNITY_LINKS.githubProfile} {...EXTERNAL_LINK_ATTRIBUTES}>GitHub profile</a>
          <a href={COMMUNITY_LINKS.website} {...EXTERNAL_LINK_ATTRIBUTES}>Website</a>
          <a href={COMMUNITY_LINKS.sponsor} {...EXTERNAL_LINK_ATTRIBUTES}>Sponsor</a>
        </nav>
      </section>
    </ModalShell>

    <ModalShell
      open={props.shareFallbackOpen}
      title="Share link"
      closeLabel="Close share link"
      onDismiss={props.onDismissShare}
      returnFocusRef={props.shareReturnFocusRef}
      initialFocusSelector="[data-image-share-url-input]"
      className="share-fallback-dialog"
    >
      <p>Your browser could not copy this link automatically. Select it and copy it manually.</p>
      <label htmlFor="image-share-url">Share URL</label>
      <textarea
        id="image-share-url"
        ref={shareUrlRef}
        data-image-share-url-input
        readOnly
        value={CANONICAL_IMAGE_URL}
      />
    </ModalShell>

    <ModalShell
      open={(props.removeItems?.length ?? 0) > 0}
      title="Remove images?"
      closeLabel="Cancel image removal"
      onDismiss={() => props.onDismissRemove?.()}
      returnFocusRef={props.removeReturnFocusRef}
      className="image-remove-dialog confirm-dialog"
      initialFocusSelector="[data-image-remove]"
    >
      <p>This removes the selected local occurrence{props.removeItems?.length === 1 ? "" : "s"} from this session.</p>
      <ul>{props.removeItems?.map((item) => <li key={item.id}>{item.name}</li>)}</ul>
      <div className="dialog-actions">
        <button type="button" data-image-remove className="danger-action" onClick={() => props.onConfirmRemove?.()}>
          REMOVE {props.removeItems?.length ?? 0} {(props.removeItems?.length ?? 0) === 1 ? "IMAGE" : "IMAGES"}
        </button>
        <button type="button" onClick={() => {
          props.onDismissRemove?.();
          restoreFocus(props.removeReturnFocusRef);
        }}>CANCEL</button>
      </div>
    </ModalShell>
  </>;
}
