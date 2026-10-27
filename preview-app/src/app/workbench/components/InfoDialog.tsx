import { APP_VERSION } from "../../../version";
import { CURRENT_RELEASE_POST_PATH } from "../../../updates/currentRelease";
import { COMMUNITY_LINKS, EXTERNAL_LINK_ATTRIBUTES } from "../community";
import { ModalShell } from "./ModalShell";

interface InfoDialogProps {
  open: boolean;
  onClose(): void;
  returnFocusRef?: React.RefObject<HTMLButtonElement | null>;
}

export function InfoDialog({ open, onClose, returnFocusRef }: InfoDialogProps) {
  return <ModalShell open={open} title="About reword-nerd" closeLabel="Close info" onDismiss={onClose} returnFocusRef={returnFocusRef} className="info-dialog">
    <div className="info-identity">
      <img src={`${import.meta.env.BASE_URL}brand/reword-nerd-logo.webp`} width="128" height="128" alt="reword-nerd logo" />
      <div><strong>reword-nerd v{APP_VERSION}</strong><p>A local, browser-only workbench for building inspectable multi-pass rewriting prompt packages.</p></div>
    </div>
    <p>Files, extraction, package generation, and previews remain on this device. No provider account or API key is required.</p>
    <section className="info-group" aria-labelledby="info-product-heading">
      <h3 id="info-product-heading">Product</h3>
      <nav className="info-group-links" aria-label="Product links">
        <a href={CURRENT_RELEASE_POST_PATH}>Updates</a>
        <a href={COMMUNITY_LINKS.repository} {...EXTERNAL_LINK_ATTRIBUTES}>Repository</a>
      </nav>
    </section>
    <section className="info-group" aria-labelledby="info-community-heading">
      <h3 id="info-community-heading">Community</h3>
      <p>Issues are public. Use synthetic descriptions only; never attach documents, packages, prompts, credentials, or confidential material.</p>
      <nav className="info-group-links" aria-label="Community links">
        <a href={COMMUNITY_LINKS.reportBug} {...EXTERNAL_LINK_ATTRIBUTES}>Report a bug</a>
        <a href={COMMUNITY_LINKS.suggestFeature} {...EXTERNAL_LINK_ATTRIBUTES}>Suggest a feature</a>
        <a href={COMMUNITY_LINKS.securityReporting} {...EXTERNAL_LINK_ATTRIBUTES}>Security reporting</a>
      </nav>
    </section>
    <section className="info-group info-creator" aria-labelledby="info-creator-heading">
      <h3 id="info-creator-heading">Creator</h3>
      <p>Built by Ryan Kamp. More projects, contact details, and ways to support independent work.</p>
      <nav className="info-group-links" aria-label="Creator links">
        <a href={COMMUNITY_LINKS.githubProfile} {...EXTERNAL_LINK_ATTRIBUTES}>GitHub profile</a>
        <a href={COMMUNITY_LINKS.website} {...EXTERNAL_LINK_ATTRIBUTES}>Website</a>
        <a href={COMMUNITY_LINKS.sponsor} {...EXTERNAL_LINK_ATTRIBUTES}>Sponsor</a>
      </nav>
    </section>
  </ModalShell>;
}
