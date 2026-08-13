import { APP_VERSION } from "../../../version";
import { ModalShell } from "./ModalShell";

interface InfoDialogProps {
  open: boolean;
  onClose(): void;
  returnFocusRef?: React.RefObject<HTMLButtonElement | null>;
}

const website = "https://ryanjosephkamp.github.io";
const creatorLinks = [
  ["GitHub profile", "https://github.com/ryanjosephkamp/"],
  ["Website", website],
  ["Sponsor", "https://github.com/sponsors/ryanjosephkamp"],
] as const;

export function InfoDialog({ open, onClose, returnFocusRef }: InfoDialogProps) {
  return <ModalShell open={open} title="About reword-nerd" closeLabel="Close info" onDismiss={onClose} returnFocusRef={returnFocusRef} className="info-dialog">
    <div className="info-identity">
      <img src={`${import.meta.env.BASE_URL}brand/reword-nerd-logo.webp`} width="128" height="128" alt="reword-nerd logo" />
      <div><strong>reword-nerd v{APP_VERSION}</strong><p>A local, browser-only workbench for building inspectable multi-pass rewriting prompt packages.</p></div>
    </div>
    <p>Files, extraction, package generation, and previews remain on this device. No provider account or API key is required.</p>
    <a className="info-repository-link" aria-label="Repository" href="https://github.com/ryanjosephkamp/reword-nerd" target="_blank" rel="noopener noreferrer">
      <strong>Repository</strong><span>Source, documentation, and releases</span>
    </a>
    <section className="info-creator" aria-labelledby="info-creator-heading">
      <h3 id="info-creator-heading">Built by <a href={website} target="_blank" rel="noopener noreferrer">Ryan Kamp</a></h3>
      <p>More projects, contact details, and ways to support independent work.</p>
      <nav className="info-creator-links" aria-label="Creator links">
        {creatorLinks.map(([label, href]) => <a key={label} href={href} target="_blank" rel="noopener noreferrer">{label}</a>)}
      </nav>
    </section>
  </ModalShell>;
}
