import { APP_VERSION } from "../../../version";
import { ModalShell } from "./ModalShell";

interface InfoDialogProps {
  open: boolean;
  onClose(): void;
  returnFocusRef?: React.RefObject<HTMLButtonElement | null>;
}

const links = [
  ["Repository", "https://github.com/ryanjosephkamp/reword-nerd"],
  ["GitHub", "https://github.com/ryanjosephkamp/"],
  ["Website", "https://ryanjosephkamp.github.io"],
  ["Sponsor", "https://github.com/sponsors/ryanjosephkamp"],
] as const;

export function InfoDialog({ open, onClose, returnFocusRef }: InfoDialogProps) {
  return <ModalShell open={open} title="About reword-nerd" closeLabel="Close info" onDismiss={onClose} returnFocusRef={returnFocusRef}>
    <div className="info-identity">
      <img src={`${import.meta.env.BASE_URL}brand/reword-nerd-logo.webp`} width="128" height="128" alt="reword-nerd logo" />
      <div><strong>reword-nerd v{APP_VERSION}</strong><p>A local, browser-only workbench for building inspectable multi-pass rewriting prompt packages.</p></div>
    </div>
    <p>Files, extraction, package generation, and previews remain on this device. No provider account or API key is required.</p>
    <div className="info-links">{links.map(([label, href]) => <a key={label} href={href} target="_blank" rel="noopener noreferrer">{label}</a>)}</div>
    <p>Built by <a href="https://ryanjosephkamp.github.io" target="_blank" rel="noopener noreferrer">Ryan Kamp</a>.</p>
  </ModalShell>;
}
