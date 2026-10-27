import type { LocalTextSource } from "./LocalTextRun";
import type { ImagePortalState } from "../../image/reducer";
import { useEffect, useMemo, useState } from "react";
import type { WorkbenchState } from "../workbench/contracts";
import { studioCandidates, workbenchCandidates, type StudioCollectionSources } from "./collectionSources";
import { Article, ImageSquare, FolderSimple, TerminalWindow, ArrowUpRight } from "@phosphor-icons/react";
import { Studio } from "../studio/Studio";
import { Workbench } from "../workbench/Workbench";
import { ImageWorkbench } from "../../image/workbench/ImageWorkbench";
import { WorkspaceActivityProvider } from "./WorkspaceActivity";
import { AppearanceControls, useAppearance } from "./appearance";
import { Runs } from "./Runs";
import "../../styles/image-workbench.css";
import "./platform.css";

export type PlatformMode = "text" | "images" | "projects" | "runs";
function readMode(): PlatformMode {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode");
  if (mode === "text" || mode === "images" || mode === "projects" || mode === "runs") return mode;
  if (window.location.pathname.includes("/image")) return "images";
  return params.get("workbench") === "classic" ? "projects" : "text";
}
const modes = [
  { id: "text", label: "Text", icon: Article },
  { id: "images", label: "Images", icon: ImageSquare },
  { id: "projects", label: "Projects", icon: FolderSimple },
  { id: "runs", label: "Runs", icon: TerminalWindow },
] as const;

export function UnifiedPlatform({ initialMode }: { initialMode?: PlatformMode }) {
  const [mode, setMode] = useState<PlatformMode>(() => new URLSearchParams(window.location.search).has("mode") ? readMode() : initialMode ?? readMode());
  const [localSource,setLocalSource]=useState<LocalTextSource|null>(null);
  const [imageState,setImageState]=useState<ImagePortalState|null>(null);
  const [studioSources,setStudioSources]=useState<StudioCollectionSources|null>(null);
  const [workbenchSources,setWorkbenchSources]=useState<WorkbenchState|null>(null);
  const collectionSources=useMemo(()=>[...studioCandidates(studioSources),...workbenchCandidates(workbenchSources)],[studioSources,workbenchSources]);
  const [advanced, setAdvanced] = useState(false);
  const appearance = useAppearance();
  const imageActive = mode === "images";
  const advancedActive = mode === "projects" || (mode === "text" && advanced);
  const studioActive = mode === "text" && !advanced;
  const [visited, setVisited] = useState(() => new Set<PlatformMode>([mode]));
  const selectMode = (next: PlatformMode) => {
    setMode(next);
    setVisited(current => new Set([...current, next]));
    const url = new URL(window.location.href);
    url.searchParams.delete("view"); url.searchParams.delete("workbench");
    url.searchParams.set("mode", next);
    window.history.pushState({}, "", url);
  };
  useEffect(() => {
    const onPopState = () => { const next = readMode(); setMode(next); setVisited(current => new Set([...current, next])); };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  return <div className="unified-platform" data-palette={appearance.palette} data-appearance={appearance.mode}>
    <header className="platform-header">
      <a className="studio-brand platform-brand" href={`${import.meta.env.BASE_URL}?view=welcome`} target="_blank" rel="noreferrer" aria-label="About reword-nerd (opens in a new tab)">
        <span className="studio-brand-mark" aria-hidden="true"><span>r</span><span>n</span></span>
        <span>reword<span className="studio-brand-dash">_</span>nerd<span className="studio-brand-period">.</span></span>
      </a>
      <nav className="platform-modes" aria-label="Workspace modes">{modes.map(item => <button key={item.id} aria-current={mode === item.id ? "page" : undefined} onClick={() => selectMode(item.id)}><item.icon size={18} aria-hidden="true" />{item.label}</button>)}</nav>
      <AppearanceControls {...appearance} />
    </header>
    <div className="platform-session-note"><span><span className="platform-memory-dot" aria-hidden="true" />Local workspace · edits stay in this tab’s memory</span><span>Export to keep your work</span></div>
    {mode === "text" && <div className="platform-text-tools"><div role="group" aria-label="Text workspace view"><button aria-pressed={!advanced} onClick={() => setAdvanced(false)}>Writing studio</button><button aria-pressed={advanced} onClick={() => { setAdvanced(true); setVisited(current => new Set([...current, "projects"])); }}>Advanced sources & OCR</button></div><span>Documents, code and structured text</span></div>}
    <section hidden={!studioActive} inert={!studioActive} aria-label="Text mode"><WorkspaceActivityProvider active={studioActive}><Studio onLocalSourceChange={setLocalSource} onCollectionSourcesChange={setStudioSources} embedded active={studioActive} appearanceMode={appearance.mode} onToggleAppearance={() => appearance.setMode(appearance.mode === "dark" ? "light" : "dark")} onAdvancedSources={() => {setAdvanced(true);setVisited(current => new Set([...current, "projects"]));}} /></WorkspaceActivityProvider></section>
    {(visited.has("images") || imageActive) && <section hidden={!imageActive} inert={!imageActive} className="platform-embedded" aria-label="Images mode"><ImageWorkbench embedded active={imageActive} onStateChange={setImageState} />{imageState?.builtOutput && <div className="platform-session-note"><span>Package ready. Inspect its exact prompt and attachment before any send.</span><button className="studio-secondary" onClick={() => selectMode("runs")}>Review in Runs</button></div>}</section>}
    {(visited.has("projects") || advancedActive) && <section hidden={!advancedActive} inert={!advancedActive} className="platform-embedded" aria-label="Projects and advanced sources"><Workbench embedded active={advancedActive} onStateChange={setWorkbenchSources} workspaceLabel={mode === "projects" ? "Project workspace" : "Advanced sources & OCR"} /></section>}
    <section hidden={mode !== "runs"} inert={mode !== "runs"} aria-label="Runs mode"><Runs imageState={imageState} localSource={localSource} collectionSources={collectionSources} /></section>
    <footer className="platform-footer"><span>reword_nerd / local preview</span><a href={`${import.meta.env.BASE_URL}?view=welcome`} target="_blank" rel="noreferrer">About the workflow <ArrowUpRight size={12} /></a></footer>
  </div>;
}
