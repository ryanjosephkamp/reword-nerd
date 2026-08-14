import { useEffect, useRef, useState, type RefObject } from "react";
import { PortalSwitcher } from "../../portal/PortalSwitcher";
import { FolderIcon, GearIcon, HelpIcon, InfoIcon, MoreIcon, RestartIcon, ShareIcon } from "./Icons";

interface HeaderProps {
  onOpenFiles(): void;
  onOpenSettings(): void;
  onOpenHelp(returnFocus: HTMLButtonElement): void;
  onOpenInfo(returnFocus: HTMLButtonElement): void;
  onShare(returnFocus: HTMLButtonElement): void;
  onNewSession(returnFocus: HTMLButtonElement): void;
  settingsExpanded: boolean;
  settingsControls: string;
  settingsButtonRef: RefObject<HTMLButtonElement | null>;
  hasSessionWork: boolean;
  onClearSessionForPortal(): void;
}

export function Header({ onOpenFiles, onOpenSettings, onOpenHelp, onOpenInfo, onShare, onNewSession, settingsExpanded, settingsControls, settingsButtonRef, hasSessionWork, onClearSessionForPortal }: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !menuButtonRef.current?.contains(target)) setMenuOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [menuOpen]);
  return <header className="workbench-header">
    <div className="brand-portal">
      <h1 className="brand">reword_nerd/</h1>
      <PortalSwitcher currentPortal="text" hasSessionWork={hasSessionWork} onClearSession={onClearSessionForPortal} />
    </div>
    <div className="session-copy"><strong>LOCAL SESSION</strong><span>Files stay in this browser</span></div>
    <div className="header-actions" aria-label="Workspace utilities">
      <button type="button" className="icon-button folder-button" aria-label="Open files" onClick={onOpenFiles}><FolderIcon /></button>
      <button type="button" className="icon-button restart-button" aria-label="New session" onClick={(event) => onNewSession(event.currentTarget)}><RestartIcon /></button>
      <button type="button" className="icon-button settings-button" aria-label="Settings" aria-expanded={settingsExpanded} aria-controls={settingsControls} onClick={onOpenSettings} ref={settingsButtonRef}><GearIcon /></button>
      <button type="button" className="icon-button help-button" aria-label="Help" onClick={(event) => onOpenHelp(event.currentTarget)}><HelpIcon /></button>
      <button type="button" className="icon-button info-button" aria-label="Info" onClick={(event) => onOpenInfo(event.currentTarget)}><InfoIcon /></button>
      <button type="button" className="icon-button share-button" aria-label="Share" onClick={(event) => onShare(event.currentTarget)}><ShareIcon /></button>
      <button
        type="button"
        className="icon-button mobile-menu"
        aria-label="Menu"
        aria-expanded={menuOpen}
        aria-controls="mobile-utility-menu"
        onClick={() => setMenuOpen((open) => !open)}
        ref={menuButtonRef}
      ><MoreIcon /></button>
      {menuOpen ? <div id="mobile-utility-menu" className="mobile-utility-menu" aria-label="Mobile utilities" ref={menuRef}>
        <button type="button" onClick={() => { setMenuOpen(false); onOpenSettings(); }}>Settings</button>
        <button type="button" onClick={() => {
          const returnFocus = menuButtonRef.current;
          setMenuOpen(false);
          if (returnFocus) onOpenHelp(returnFocus);
        }}>Help</button>
        <button type="button" onClick={() => {
          const returnFocus = menuButtonRef.current;
          setMenuOpen(false);
          if (returnFocus) onOpenInfo(returnFocus);
        }}>Info</button>
        <button type="button" onClick={() => {
          const returnFocus = menuButtonRef.current;
          setMenuOpen(false);
          if (returnFocus) onShare(returnFocus);
        }}>Share</button>
        <button type="button" onClick={() => {
          const returnFocus = menuButtonRef.current;
          setMenuOpen(false);
          if (returnFocus) onNewSession(returnFocus);
        }}>New session</button>
      </div> : null}
    </div>
  </header>;
}
