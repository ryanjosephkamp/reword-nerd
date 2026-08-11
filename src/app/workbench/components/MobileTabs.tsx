import type { KeyboardEvent } from "react";
import type { MobileTab } from "../contracts";

const tabs: MobileTab[] = ["files", "preview", "settings"];

export function MobileTabs({ active, onChange }: { active: MobileTab; onChange(tab: MobileTab): void }) {
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, tab: MobileTab) => {
    const index = tabs.indexOf(tab);
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    onChange(tabs[next]);
    document.getElementById(`tab-${tabs[next]}`)?.focus();
  };
  return <nav className="mobile-tabs" aria-label="Workbench panels">
    <div role="tablist" aria-orientation="horizontal">
      {tabs.map((tab) => <button
        type="button"
        role="tab"
        id={`tab-${tab}`}
        aria-controls={`panel-${tab}`}
        aria-selected={active === tab}
        tabIndex={active === tab ? 0 : -1}
        key={tab}
        onClick={() => onChange(tab)}
        onKeyDown={(event) => onKeyDown(event, tab)}
      >{tab.toUpperCase()}</button>)}
    </div>
  </nav>;
}
