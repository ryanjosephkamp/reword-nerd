import { forwardRef } from "react";
import { PortalSwitcher } from "../../app/portal/PortalSwitcher";
import {
  FolderIcon,
  GearIcon,
  HelpIcon,
  InfoIcon,
  RestartIcon,
  ShareIcon,
} from "../../app/workbench/components/Icons";

export interface ImageHeaderProps {
  readonly hasSessionWork: boolean;
  readonly settingsExpanded: boolean;
  readonly onOpenFiles: () => void;
  readonly onNewSession: () => void;
  readonly onOpenSettings: () => void;
  readonly onOpenHelp: (returnFocus: HTMLButtonElement) => void;
  readonly onOpenInfo: (returnFocus: HTMLButtonElement) => void;
  readonly onShare: () => void;
  readonly onClearSession: () => void;
}

export const ImageHeader = forwardRef<HTMLButtonElement, ImageHeaderProps>(function ImageHeader(props, settingsButtonRef) {
  return <header className="image-header">
    <div className="brand-portal">
      <h1 className="brand">reword_nerd/</h1>
      <PortalSwitcher
        currentPortal="image"
        hasSessionWork={props.hasSessionWork}
        onClearSession={props.onClearSession}
      />
    </div>
    <div className="image-session-copy">
      <strong>LOCAL SESSION</strong>
      <span>Files stay in this browser</span>
    </div>
    <div className="image-header-actions" aria-label="Image workspace utilities">
      <button type="button" className="icon-button" aria-label="Open files" onClick={props.onOpenFiles}><FolderIcon /></button>
      <button type="button" className="icon-button" aria-label="New session" onClick={props.onNewSession}><RestartIcon /></button>
      <button
        type="button"
        className="icon-button"
        aria-label="Settings"
        aria-expanded={props.settingsExpanded}
        aria-controls="image-panel-settings"
        onClick={props.onOpenSettings}
        ref={settingsButtonRef}
      ><GearIcon /></button>
      <button type="button" className="icon-button" aria-label="Help" onClick={(event) => props.onOpenHelp(event.currentTarget)}><HelpIcon /></button>
      <button type="button" className="icon-button" aria-label="Info" onClick={(event) => props.onOpenInfo(event.currentTarget)}><InfoIcon /></button>
      <button type="button" className="icon-button" aria-label="Share" onClick={props.onShare}><ShareIcon /></button>
    </div>
  </header>;
});
