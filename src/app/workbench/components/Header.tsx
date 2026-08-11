import { useRef, useState, type RefObject } from "react";
import { FolderIcon, GearIcon, HelpIcon, MoreIcon } from "./Icons";

interface HeaderProps {
  onOpenFiles(): void;
  onOpenSettings(): void;
  onOpenHelp(returnFocus: HTMLButtonElement): void;
  settingsButtonRef: RefObject<HTMLButtonElement | null>;
}

export function Header({ onOpenFiles, onOpenSettings, onOpenHelp, settingsButtonRef }: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  return <header className="workbench-header">
    <h1 className="brand">reword_nerd/</h1>
    <div className="session-copy"><strong>LOCAL SESSION</strong><span>Files stay in this browser</span></div>
    <div className="header-actions" aria-label="Workspace utilities">
      <button type="button" className="icon-button folder-button" aria-label="Open files" onClick={onOpenFiles}><FolderIcon /></button>
      <button type="button" className="icon-button settings-button" aria-label="Settings" onClick={onOpenSettings} ref={settingsButtonRef}><GearIcon /></button>
      <button type="button" className="icon-button help-button" aria-label="Help" onClick={(event) => onOpenHelp(event.currentTarget)}><HelpIcon /></button>
      <button
        type="button"
        className="icon-button mobile-menu"
        aria-label="Menu"
        aria-expanded={menuOpen}
        aria-controls="mobile-utility-menu"
        onClick={() => setMenuOpen((open) => !open)}
        ref={menuButtonRef}
      ><MoreIcon /></button>
      {menuOpen ? <div id="mobile-utility-menu" className="mobile-utility-menu" role="menu">
        <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onOpenSettings(); }}>Settings</button>
        <button type="button" role="menuitem" onClick={() => {
          const returnFocus = menuButtonRef.current;
          setMenuOpen(false);
          if (returnFocus) onOpenHelp(returnFocus);
        }}>Help</button>
      </div> : null}
    </div>
  </header>;
}
