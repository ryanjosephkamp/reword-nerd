import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

type Side = "files" | "side";

interface PanelState {
  /** Width in pixels, or null for the default width. */
  width: number | null;
  open: boolean;
}

type LayoutState = Record<Side, PanelState>;

const KEY = "reword-nerd:layout";
const LIMITS: Record<Side, { min: number; max: number; fallback: number }> = {
  files: { min: 200, max: 440, fallback: 264 },
  side: { min: 300, max: 600, fallback: 384 },
};
const CENTER_MIN = 360;

function readLayout(name: string): LayoutState {
  const fallback: LayoutState = {
    files: { width: null, open: true },
    side: { width: null, open: true },
  };
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}")[name];
    if (!stored) return fallback;
    const panel = (side: Side): PanelState => ({
      width: typeof stored[side]?.width === "number" ? stored[side].width : null,
      open: stored[side]?.open !== false,
    });
    return { files: panel("files"), side: panel("side") };
  } catch {
    return fallback;
  }
}

function saveLayout(name: string, layout: LayoutState) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    localStorage.setItem(KEY, JSON.stringify({ ...all, [name]: layout }));
  } catch {
    // The layout still applies for this visit.
  }
}

interface SplitterProps {
  side: Side;
  label: string;
  controls: string;
  state: PanelState;
  current: () => number;
  onResize: (width: number | null, open: boolean, save: boolean) => void;
  bounds: () => { min: number; max: number };
  edge: () => number;
}

function Splitter({
  side,
  label,
  controls,
  state,
  current,
  onResize,
  bounds,
  edge,
}: SplitterProps) {
  const dragging = useRef(false);
  const toggle = () => onResize(state.width, !state.open, true);
  const CollapseIcon = (side === "files") === state.open ? CaretLeft : CaretRight;

  const widthAt = (clientX: number) => (side === "files" ? clientX - edge() : edge() - clientX);

  const keyDown = (event: KeyboardEvent) => {
    const { min, max } = bounds();
    const step = event.shiftKey ? 64 : 16;
    const grow = side === "files" ? 1 : -1;
    let next: number | null = null;
    if (event.key === "ArrowLeft") next = current() - step * grow;
    else if (event.key === "ArrowRight") next = current() + step * grow;
    else if (event.key === "Home") next = min;
    else if (event.key === "End") next = max;
    else if (event.key === "Enter") {
      event.preventDefault();
      toggle();
      return;
    }
    if (next === null) return;
    event.preventDefault();
    onResize(Math.round(Math.min(max, Math.max(min, next))), true, true);
  };

  return (
    <div className={`splitter splitter-${side}`} data-open={state.open}>
      <div
        className="splitter-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-controls={controls}
        aria-valuemin={bounds().min}
        aria-valuemax={bounds().max}
        aria-valuenow={state.open ? Math.round(current()) : 0}
        tabIndex={0}
        onKeyDown={keyDown}
        onDoubleClick={() => onResize(null, true, true)}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          document.documentElement.classList.add("resizing");
        }}
        onPointerMove={(event) => {
          if (!dragging.current) return;
          const { min, max } = bounds();
          const width = widthAt(event.clientX);
          // Dragging a panel most of the way closed hides it, the way editors do.
          if (width < min / 2) onResize(state.width, false, false);
          else onResize(Math.round(Math.min(max, Math.max(min, width))), true, false);
        }}
        onPointerUp={(event) => {
          if (!dragging.current) return;
          dragging.current = false;
          event.currentTarget.releasePointerCapture(event.pointerId);
          document.documentElement.classList.remove("resizing");
          onResize(state.width, state.open, true);
        }}
      />
      <button
        type="button"
        className="splitter-toggle"
        aria-expanded={state.open}
        aria-controls={controls}
        aria-label={`${state.open ? "Hide" : "Show"} ${label.replace(/^Resize the /, "the ")}`}
        title={state.open ? "Hide panel" : "Show panel"}
        onClick={toggle}
      >
        <CollapseIcon aria-hidden weight="bold" />
      </button>
    </div>
  );
}

interface WorkspaceLayoutProps {
  name: "text" | "images";
  /** The pane shown on phones, where only one fits at a time. */
  pane: "files" | "document" | "handoff";
  filesLabel: string;
  sideLabel: string;
  files: ReactNode;
  center: ReactNode;
  side: ReactNode;
}

/** Three panes on wide screens, with draggable and hideable side panels; one pane on phones. */
export function WorkspaceLayout({
  name,
  pane,
  filesLabel,
  sideLabel,
  files,
  center,
  side,
}: WorkspaceLayoutProps) {
  const [layout, setLayout] = useState<LayoutState>(() => readLayout(name));
  const root = useRef<HTMLDivElement>(null);
  const filesRef = useRef<HTMLDivElement>(null);
  const sideRef = useRef<HTMLElement>(null);

  const measured = (which: Side) => {
    const element = which === "files" ? filesRef.current : sideRef.current;
    return element?.getBoundingClientRect().width || layout[which].width || LIMITS[which].fallback;
  };
  const bounds = (which: Side) => {
    const total = root.current?.getBoundingClientRect().width ?? 1280;
    const other: Side = which === "files" ? "side" : "files";
    const otherWidth = layout[other].open ? measured(other) : 0;
    const room = total - otherWidth - CENTER_MIN;
    return {
      min: LIMITS[which].min,
      max: Math.max(LIMITS[which].min, Math.min(LIMITS[which].max, room)),
    };
  };
  const update = (which: Side) => (width: number | null, open: boolean, save: boolean) => {
    setLayout((previous) => {
      const next = { ...previous, [which]: { width, open } };
      if (save) saveLayout(name, next);
      return next;
    });
  };

  const style = {
    "--files-width": layout.files.width ? `${layout.files.width}px` : undefined,
    "--side-width": layout.side.width ? `${layout.side.width}px` : undefined,
  } as CSSProperties;

  return (
    <div
      ref={root}
      className="workspace"
      data-pane={pane}
      data-files={layout.files.open ? "open" : "closed"}
      data-side={layout.side.open ? "open" : "closed"}
      style={style}
    >
      <div ref={filesRef} id={`${name}-files-pane`} className="workspace-files">
        {files}
      </div>
      <Splitter
        side="files"
        label={`Resize the ${filesLabel} panel`}
        controls={`${name}-files-pane`}
        state={layout.files}
        current={() => measured("files")}
        bounds={() => bounds("files")}
        edge={() => root.current?.getBoundingClientRect().left ?? 0}
        onResize={update("files")}
      />
      <div className="workspace-center">{center}</div>
      <Splitter
        side="side"
        label={`Resize the ${sideLabel} panel`}
        controls={`${name}-side-pane`}
        state={layout.side}
        current={() => measured("side")}
        bounds={() => bounds("side")}
        edge={() => root.current?.getBoundingClientRect().right ?? window.innerWidth}
        onResize={update("side")}
      />
      <aside
        ref={sideRef}
        id={`${name}-side-pane`}
        className="workspace-side"
        aria-label={sideLabel.charAt(0).toUpperCase() + sideLabel.slice(1)}
      >
        {side}
      </aside>
    </div>
  );
}
