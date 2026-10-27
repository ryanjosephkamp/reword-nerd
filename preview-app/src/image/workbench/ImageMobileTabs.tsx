import type { KeyboardEvent } from "react";
import type { ImageMobileTab } from "./contracts";

const TABS: readonly ImageMobileTab[] = ["images", "preview", "settings"];
const LABELS: Readonly<Record<ImageMobileTab, string>> = {
  images: "IMAGES",
  preview: "PREVIEW",
  settings: "SETTINGS",
};

export function ImageMobileTabs({
  active,
  onChange,
}: {
  active: ImageMobileTab;
  onChange(tab: ImageMobileTab): void;
}) {
  const selectFromKey = (event: KeyboardEvent<HTMLButtonElement>, tab: ImageMobileTab) => {
    const index = TABS.indexOf(tab);
    let target: ImageMobileTab | undefined;
    if (event.key === "ArrowRight") target = TABS[(index + 1) % TABS.length];
    else if (event.key === "ArrowLeft") target = TABS[(index - 1 + TABS.length) % TABS.length];
    else if (event.key === "Home") target = TABS[0];
    else if (event.key === "End") target = TABS[TABS.length - 1];
    if (!target) return;
    event.preventDefault();
    onChange(target);
    document.getElementById(`image-tab-${target}`)?.focus();
  };

  return <nav className="image-mobile-tabs" aria-label="Image workbench panels">
    <div role="tablist" aria-label="Image workbench panels" aria-orientation="horizontal">
      {TABS.map((tab) => <button
        key={tab}
        id={`image-tab-${tab}`}
        type="button"
        role="tab"
        aria-controls={`image-panel-${tab}`}
        aria-selected={active === tab}
        tabIndex={active === tab ? 0 : -1}
        onClick={() => onChange(tab)}
        onKeyDown={(event) => selectFromKey(event, tab)}
      >{LABELS[tab]}</button>)}
    </div>
  </nav>;
}
