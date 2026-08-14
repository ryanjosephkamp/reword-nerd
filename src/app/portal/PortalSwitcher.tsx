import { useState } from "react";
import { ModalShell } from "../workbench/components/ModalShell";
import { portalHref, type Portal } from "./portalUrls";

interface PortalSwitcherProps {
  currentPortal: Portal;
  hasSessionWork: boolean;
  onClearSession(): void;
  basePath?: string;
  onNavigate?(href: string): void;
  onOpenNewTab?(href: string): void;
}

export function PortalSwitcher({ currentPortal, hasSessionWork, onClearSession, basePath, onNavigate, onOpenNewTab }: PortalSwitcherProps) {
  const [targetPortal, setTargetPortal] = useState<Portal | null>(null);
  const navigate = (href: string) => {
    if (onNavigate) onNavigate(href);
    else window.location.assign(href);
  };
  const openNewTab = (href: string) => {
    if (onOpenNewTab) onOpenNewTab(href);
    else window.open(href, "_blank", "noopener");
  };
  const requestPortal = (portal: Portal) => {
    if (portal === currentPortal) return;
    if (hasSessionWork) {
      setTargetPortal(portal);
      return;
    }
    navigate(portalHref(portal, basePath));
  };
  const targetHref = targetPortal ? portalHref(targetPortal, basePath) : "";
  const targetLabel = targetPortal === "image" ? "Image" : "Text";
  const currentLabel = currentPortal === "image" ? "Image" : "Text";

  return <>
    <nav className="portal-switcher" aria-label="Workbench portal">
      {(["text", "image"] as const).map((portal) => <a
        key={portal}
        className={`portal-link portal-link-${portal}${portal === currentPortal ? " is-active" : ""}`}
        href={portalHref(portal, basePath)}
        aria-current={portal === currentPortal ? "page" : undefined}
        onClick={(event) => {
          event.preventDefault();
          requestPortal(portal);
        }}
      >{portal.toUpperCase()}</a>)}
    </nav>
    <ModalShell
      open={targetPortal !== null}
      title={`Switch to ${targetLabel}?`}
      closeLabel="Close portal switch confirmation"
      onDismiss={() => setTargetPortal(null)}
      className="portal-switch-dialog confirm-dialog"
      initialFocusSelector="[data-portal-choice]"
    >
      <p>Your current {currentLabel} session stays in memory unless you explicitly clear it.</p>
      <div className="dialog-actions">
        <button type="button" data-portal-choice onClick={() => {
          openNewTab(targetHref);
          setTargetPortal(null);
        }}>Open {targetLabel} in a new tab</button>
        <button type="button" data-portal-choice className="danger-action" onClick={() => {
          onClearSession();
          navigate(targetHref);
        }}>Clear {currentLabel} session and open {targetLabel}</button>
      </div>
    </ModalShell>
  </>;
}
