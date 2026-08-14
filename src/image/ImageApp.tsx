import { useRef, useState } from "react";
import { PortalSwitcher } from "../app/portal/PortalSwitcher";
import { ModalShell } from "../app/workbench/components/ModalShell";
import { COMMUNITY_LINKS, EXTERNAL_LINK_ATTRIBUTES } from "../app/workbench/community";
import { CURRENT_RELEASE_POST_PATH } from "../updates/currentRelease";
import { CANONICAL_IMAGE_URL, shareImageCanonicalUrl } from "./share";

const artworkPath = `${import.meta.env.BASE_URL}image/orange-pyramid.webp`;

export function ImageApp() {
  const [infoOpen, setInfoOpen] = useState(false);
  const [shareMessage, setShareMessage] = useState("");
  const infoButtonRef = useRef<HTMLButtonElement>(null);
  const share = () => {
    setShareMessage("");
    void shareImageCanonicalUrl().then((result) => {
      if (result === "shared") setShareMessage("Link shared.");
      else if (result === "copied") setShareMessage("Link copied.");
      else if (result === "manual") setShareMessage(`Copy ${CANONICAL_IMAGE_URL}`);
    });
  };

  return <main className="image-shell" aria-label="reword_nerd Image portal">
    <header className="image-shell-header">
      <div className="brand-portal">
        <h1 className="brand">reword_nerd/</h1>
        <PortalSwitcher currentPortal="image" hasSessionWork={false} onClearSession={() => undefined} />
      </div>
      <div className="image-shell-actions" aria-label="Image portal utilities">
        <button type="button" onClick={() => setInfoOpen(true)} ref={infoButtonRef}>Info</button>
        <button type="button" onClick={share}>Share</button>
      </div>
    </header>
    <section className="image-shell-poster" aria-labelledby="image-shell-title">
      <img src={artworkPath} width="512" height="512" alt="Orange pyramid artwork" />
      <div>
        <p className="image-shell-kicker">LOCAL IMAGE PORTAL</p>
        <h2 id="image-shell-title">IMAGE WORKBENCH ARRIVING NEXT</h2>
        <p>This shell keeps Image navigation, identity, and sharing separate while the local Image workflow is built in the next tasks.</p>
      </div>
    </section>
    <ModalShell
      open={infoOpen}
      title="About reword-nerd Image"
      closeLabel="Close Image info"
      onDismiss={() => setInfoOpen(false)}
      returnFocusRef={infoButtonRef}
      className="image-info-dialog"
    >
      <div className="image-info-identity">
        <img src={artworkPath} width="96" height="96" alt="Orange pyramid artwork" />
        <p>Image is a local, browser-only workspace. Its workbench is intentionally not part of this portal shell.</p>
      </div>
      <nav className="info-group-links" aria-label="Image portal links">
        <a href={CURRENT_RELEASE_POST_PATH}>Updates</a>
        <a href={COMMUNITY_LINKS.reportBug} {...EXTERNAL_LINK_ATTRIBUTES}>Community</a>
      </nav>
    </ModalShell>
    {shareMessage ? <p className="visually-hidden" role="status" aria-live="polite">{shareMessage}</p> : null}
  </main>;
}
