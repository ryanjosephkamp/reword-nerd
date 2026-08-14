import type { RefObject } from "react";
import { ModalShell } from "../../app/workbench/components/ModalShell";
import { COMMUNITY_LINKS, EXTERNAL_LINK_ATTRIBUTES } from "../../app/workbench/community";
import { CURRENT_RELEASE_POST_PATH } from "../../updates/currentRelease";

const artworkPath = `${import.meta.env.BASE_URL}image/orange-pyramid.webp`;

interface ImageDialogsProps {
  readonly quickStartOpen: boolean;
  readonly helpOpen: boolean;
  readonly infoOpen: boolean;
  readonly removeItems?: readonly Readonly<{ id: string; name: string }>[];
  readonly helpReturnFocusRef: RefObject<HTMLButtonElement | null>;
  readonly infoReturnFocusRef: RefObject<HTMLButtonElement | null>;
  readonly onDismissQuickStart: () => void;
  readonly onDismissHelp: () => void;
  readonly onDismissInfo: () => void;
  readonly onDismissRemove?: () => void;
  readonly onConfirmRemove?: () => void;
}

export function ImageDialogs(props: ImageDialogsProps) {
  return <>
    <ModalShell
      open={props.quickStartOpen}
      title="Image Quick Start"
      closeLabel="Close Image Quick Start"
      onDismiss={props.onDismissQuickStart}
      className="image-quick-start-dialog"
      initialFocusSelector="[data-image-start]"
    >
      <div className="image-dialog-artwork">
        <img src={artworkPath} width="112" height="112" alt="Orange pyramid artwork" />
        <div>
          <p><strong>Processing stays local in this browser; exact source bytes may retain EXIF or location metadata.</strong></p>
          <p>Each included image produces one source image and one prompt. Bulk masks require Apply, and OCR must be reviewed.</p>
          <p>Changes invalidate confirmation. Build and Download are unavailable in this preview.</p>
          <p>No model runs and nothing uploads.</p>
        </div>
      </div>
      <div className="dialog-actions"><button type="button" data-image-start onClick={props.onDismissQuickStart}>START LOCAL SESSION</button></div>
    </ModalShell>

    <ModalShell
      open={props.helpOpen}
      title="Image Help"
      closeLabel="Close Image Help"
      onDismiss={props.onDismissHelp}
      returnFocusRef={props.helpReturnFocusRef}
      className="image-help-dialog"
    >
      <p>Processing stays local. Exact source bytes may retain EXIF or location metadata.</p>
      <p>Use one source image and one prompt for each included image.</p>
      <p>Bulk masks change only checked fields after Apply.</p>
      <p>OCR text must be reviewed and accepted or rejected.</p>
      <p>Changes invalidate image-set confirmation.</p>
      <p>BUILD PACKAGE and DOWNLOAD ZIP remain unavailable in this preview.</p>
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
      <nav className="info-group-links" aria-label="Image portal links">
        <a href={CURRENT_RELEASE_POST_PATH}>Updates</a>
        <a href={COMMUNITY_LINKS.reportBug} {...EXTERNAL_LINK_ATTRIBUTES}>Community</a>
      </nav>
    </ModalShell>

    <ModalShell
      open={(props.removeItems?.length ?? 0) > 0}
      title="Remove images?"
      closeLabel="Cancel image removal"
      onDismiss={() => props.onDismissRemove?.()}
      className="image-remove-dialog confirm-dialog"
      initialFocusSelector="[data-image-remove]"
    >
      <p>This removes the selected local occurrence{props.removeItems?.length === 1 ? "" : "s"} from this session.</p>
      <ul>{props.removeItems?.map((item) => <li key={item.id}>{item.name}</li>)}</ul>
      <div className="dialog-actions">
        <button type="button" data-image-remove className="danger-action" onClick={() => props.onConfirmRemove?.()}>
          REMOVE {props.removeItems?.length ?? 0} {(props.removeItems?.length ?? 0) === 1 ? "IMAGE" : "IMAGES"}
        </button>
        <button type="button" onClick={() => props.onDismissRemove?.()}>CANCEL</button>
      </div>
    </ModalShell>
  </>;
}
