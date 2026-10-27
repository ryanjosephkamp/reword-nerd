import type { ReactNode } from "react";
import type { SettingsHelpKey } from "./settingsHelpContent";
import { SETTINGS_HELP_CONTENT } from "./settingsHelpContent";
import "../../../styles/settings-help.css";

export interface ActiveSettingsHelp {
  key: SettingsHelpKey;
  pinned: boolean;
}

export function SettingsHelpTrigger({
  helpKey,
  label,
  tooltipId,
  active,
  onPreview,
  onPin,
  onClose,
}: {
  helpKey: SettingsHelpKey;
  label: string;
  tooltipId: string;
  active: ActiveSettingsHelp | null;
  onPreview(helpKey: SettingsHelpKey): void;
  onPin(helpKey: SettingsHelpKey): void;
  onClose(): void;
}) {
  const open = active?.key === helpKey;
  return <button
    type="button"
    className="settings-help-trigger"
    aria-label={`Help about ${label}`}
    aria-controls={tooltipId}
    aria-describedby={open && !active?.pinned ? tooltipId : undefined}
    aria-expanded={open}
    onFocus={() => onPreview(helpKey)}
    onBlur={(event) => {
      if (!active?.pinned && !event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) onClose();
    }}
    onMouseEnter={() => onPreview(helpKey)}
    onMouseLeave={() => { if (!active?.pinned) onClose(); }}
    onPointerDown={() => onPin(helpKey)}
    onClick={(event) => { if (event.detail === 0) onPin(helpKey); }}
  >?</button>;
}

export function SettingsHelpPopover({
  helpKey,
  tooltipId,
  onClose,
  onMouseEnter,
  onMouseLeave,
  pinned,
  label,
}: {
  helpKey: SettingsHelpKey;
  tooltipId: string;
  onClose(): void;
  onMouseEnter(): void;
  onMouseLeave(): void;
  pinned: boolean;
  label: string;
}) {
  return <div
    id={tooltipId}
    role={pinned ? "dialog" : "tooltip"}
    aria-label={pinned ? `Help about ${label}` : undefined}
    className="settings-help-popover"
    onMouseEnter={onMouseEnter}
    onMouseLeave={onMouseLeave}
  >
    <p>{SETTINGS_HELP_CONTENT[helpKey]}</p>
    {pinned ? <button type="button" className="settings-help-close" aria-label="Close setting help" onClick={onClose}>×</button> : null}
  </div>;
}

export function SettingsHelpField({
  label,
  htmlFor,
  helpKey,
  children,
  active,
  getTooltipId,
  onPreview,
  onPin,
  onClose,
  className,
}: {
  label: string;
  htmlFor?: string;
  helpKey: SettingsHelpKey;
  children: ReactNode;
  active: ActiveSettingsHelp | null;
  getTooltipId(helpKey: SettingsHelpKey): string;
  onPreview(helpKey: SettingsHelpKey): void;
  onPin(helpKey: SettingsHelpKey): void;
  onClose(): void;
  className?: string;
}) {
  const open = active?.key === helpKey;
  const tooltipId = getTooltipId(helpKey);
  return <div className={`settings-help-field${className ? ` ${className}` : ""}`}>
    <div className="settings-help-label-row">
      {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}
      <SettingsHelpTrigger {...{ helpKey, label, tooltipId, active, onPreview, onPin, onClose }} />
    </div>
    {children}
    {open ? <SettingsHelpPopover
      helpKey={helpKey}
      tooltipId={tooltipId}
      onClose={onClose}
      onMouseEnter={() => onPreview(helpKey)}
      onMouseLeave={() => { if (!active?.pinned) onClose(); }}
      pinned={Boolean(active?.pinned)}
      label={label}
    /> : null}
  </div>;
}
