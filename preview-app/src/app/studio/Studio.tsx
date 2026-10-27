import type { StudioCollectionSources } from "../platform/collectionSources";
import type { LocalTextSource } from "../platform/LocalTextRun";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowCounterClockwise,
  ArrowUpRight,
  Article,
  BookOpen,
  CaretDown,
  Check,
  CheckCircle,
  Circle,
  Command,
  Copy,
  DownloadSimple,
  FileText,
  FolderSimple,
  Leaf,
  Lightbulb,
  List,
  MagicWand,
  MagnifyingGlass,
  Moon,
  Plus,
  ShieldCheck,
  SidebarSimple,
  SlidersHorizontal,
  Sparkle,
  Sun,
  TextAa,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useStudio } from "./useStudio";
import { StudioInsights, CompareView } from "./StudioInsights";
import { countWords } from "./textInsights";
import { StudioDialog } from "./StudioDialog";
import { StudioPackage } from "./StudioPackage";
import { studioDemoResponse } from "./studioDemoResponses";
import type { RewriteSettings, Tone } from "../../domain";
import { copyText } from "../workbench/copyText";
import { useBeforeUnloadWarning } from "../workbench/useBeforeUnloadWarning";
import "./studio.css";

type View = "read" | "edit" | "compare" | "package";
type Modal = "new" | "help" | "commands" | "replace" | null;
const recipes: {
  id: string;
  label: string;
  description: string;
  icon: typeof Leaf;
  settings: Partial<RewriteSettings>;
}[] = [
  {
    id: "clarity",
    label: "Make it clear",
    description: "Plain language. Same substance.",
    icon: Lightbulb,
    settings: { tone: "plain", length: "concise", formality: "standard" },
  },
  {
    id: "polish",
    label: "Polish it up",
    description: "Considered. Confident. Professional.",
    icon: Sparkle,
    settings: {
      tone: "professional",
      length: "preserve",
      formality: "standard",
    },
  },
  {
    id: "academic",
    label: "Go academic",
    description: "Precise language for serious ideas.",
    icon: BookOpen,
    settings: { tone: "academic", length: "preserve", formality: "formal" },
  },
];
const tones: { id: Tone; label: string }[] = [
  { id: "preserve", label: "Original" },
  { id: "plain", label: "Plain" },
  { id: "professional", label: "Professional" },
  { id: "academic", label: "Academic" },
  { id: "technical", label: "Technical" },
];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="studio-field">
      <span className="studio-field-label">{label}</span>
      {children}
    </div>
  );
}

export function Studio({ embedded = false, active = true, appearanceMode, onToggleAppearance, onAdvancedSources, onLocalSourceChange, onCollectionSourcesChange }: { embedded?: boolean; active?: boolean; appearanceMode?: "light" | "dark"; onToggleAppearance?: () => void; onAdvancedSources?: () => void; onLocalSourceChange?: (source: LocalTextSource | null) => void; onCollectionSourcesChange?: (source: StudioCollectionSources) => void }) {
  const studio = useStudio();
  const [view, setView] = useState<View>("read");
  const [inspector, setInspector] = useState<"brief" | "insights">("brief");
  const [modal, setModal] = useState<Modal>(null);
  const [focused, setFocused] = useState(false);
  const [localDay, setLocalDay] = useState(false);
  const day = appearanceMode ? appearanceMode === "light" : localDay;
  const toggleAppearance = () => onToggleAppearance ? onToggleAppearance() : setLocalDay((value) => !value);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"document" | "brief">(
    "document",
  );
  const [newText, setNewText] = useState("");
  const [newName, setNewName] = useState("Untitled.md");
  const [commandQuery, setCommandQuery] = useState("");
  const [toast, setToast] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);
  const [packageDocument, setPackageDocument] = useState(0);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const doc = studio.selectedDocument;
  useEffect(() => {
    onLocalSourceChange?.(doc ? { document: doc, settings: studio.settings, profile: studio.profile } : null);
  }, [doc, studio.settings, studio.profile, onLocalSourceChange]);
  useEffect(() => { onCollectionSourcesChange?.({ documents: studio.documents, settings: studio.settings, profile: studio.profile }); }, [studio.documents, studio.settings, studio.profile, onCollectionSourcesChange]);
  const words = useMemo(() => countWords(doc?.text ?? ""), [doc?.text]);
  const activeRecipe = recipes.find((recipe) =>
    Object.entries(recipe.settings).every(
      ([key, value]) => studio.settings[key as keyof RewriteSettings] === value,
    ),
  );
  const built = studio.builtPackage ?? studio.retainedPackage;
  const builtSources = studio.builtPackage
    ? studio.builtSourceByKey
    : studio.retainedSourceByKey;
  const packageIsStale = Boolean(built && !studio.builtPackage);
  useBeforeUnloadWarning(
    studio.documents.some(
      (item) => !item.isExample || item.text !== item.originalText,
    ) || Boolean(built),
  );
  const currentView = view === "package" && !built ? "read" : view;
  const changeView = (next: View) => {
    setView(next);
    setMobilePanel("document");
  };
  const importFiles = () => fileInput.current?.click();
  const announce = (message: string) => setToast(message);
  const build = async (confirmed = false) => {
    if (built && !confirmed) {
      setModal("replace");
      return;
    }
    await studio.buildPackage();
    setView("package");
    setMobilePanel("document");
    setPackageDocument(0);
  };
  useEffect(() => {
    if (!active) return;
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setModal((current) => (current === "commands" ? null : "commands"));
      }
      if (event.key === "Escape") {
        setFocused(false);
        setSidebarOpen(false);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [active]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  const commands = [
    {
      id: "import",
      label: "Import files",
      hint: "TXT, Markdown, PDF, DOCX",
      icon: UploadSimple,
    },
    {
      id: "new",
      label: "Create a document",
      hint: "Paste or start from scratch",
      icon: Plus,
    },
    {
      id: "focus",
      label: "Focus mode",
      hint: "Room to think",
      icon: SidebarSimple,
    },
    {
      id: "insights",
      label: "View text insights",
      hint: "Readability and sentence rhythm",
      icon: Lightbulb,
    },
    {
      id: "compare",
      label: "Compare your edits",
      hint: "Original and current text",
      icon: Article,
    },
    {
      id: "appearance",
      label: "Switch appearance",
      hint: day ? "Switch to dark appearance" : "Switch to light appearance",
      icon: Sun,
    },
  ].filter((command) =>
    (command.label + " " + command.hint)
      .toLowerCase()
      .includes(commandQuery.toLowerCase()),
  );
  const runCommand = (id: string) => {
    setModal(null);
    setCommandQuery("");
    if (id === "import") importFiles();
    if (id === "new") setModal("new");
    if (id === "focus") setFocused((value) => !value);
    if (id === "insights") {
      setFocused(false);
      setInspector("insights");
      setMobilePanel("brief");
    }
    if (id === "compare") changeView("compare");
    if (id === "appearance") toggleAppearance();
  };
  return (
    <main
      className={`nerd-studio${day ? " studio-day" : ""}${focused ? " studio-focus" : ""}${sidebarOpen ? " sidebar-open" : ""}`}
      aria-label="reword-nerd writing studio"
    >
      <a
        href="#studio-document"
        className="studio-skip-link"
        onClick={() => {
          setMobilePanel("document");
          requestAnimationFrame(() =>
            document.getElementById("studio-document")?.focus(),
          );
        }}
      >
        Skip to document
      </a>
      <input
        type="file"
        ref={fileInput}
        aria-label="Import documents"
        className="studio-file-input"
        multiple
        accept=".txt,.md,.markdown,.docx,.pdf,.tex,.py,.js,.jsx,.ts,.tsx,.json,.yaml,.yml,.toml,.csv,.html,.css,.xml,.sql,.sh,.rs,.go,.java,.c,.cpp,.h,.ini,.env,.rst"
        onChange={(event) => {
          if (event.target.files)
            void studio.importFiles(Array.from(event.target.files));
          event.target.value = "";
          setSidebarOpen(false);
          changeView("read");
        }}
      />
      <header className={`studio-topbar${embedded ? " studio-topbar-embedded" : ""}`}>
        {!embedded && <>
        <a
          className="studio-brand"
          href="?view=welcome"
          target="_blank"
          rel="noreferrer"
          aria-label="About reword-nerd (opens in a new tab)"
        >
          <span className="studio-brand-mark" aria-hidden="true">
            <span>r</span>
            <span>n</span>
          </span>
          <span>
            reword<span className="studio-brand-dash">_</span>nerd
            <span className="studio-brand-period">.</span>
          </span>
        </a>
        <nav className="studio-topnav" aria-label="Product navigation">
          <span aria-current="page">
            Writing studio <span className="studio-beta">DEMO</span>
          </span>
          <a href="?workbench=classic" target="_blank" rel="noreferrer">
            Full workbench <ArrowUpRight size={13} />
          </a>
        </nav>
        </>}
        {embedded && <div className="studio-embedded-heading"><strong>Text workspace</strong><button className="studio-secondary" onClick={onAdvancedSources}>Advanced sources & OCR <ArrowUpRight size={13} /></button></div>}
        <div className="studio-top-actions">
          <span className="studio-private">
            <span />
            Local & private
          </span>
          <button
            className="studio-command-trigger"
            onClick={() => setModal("commands")}
            aria-label="Open command menu"
          >
            <MagnifyingGlass size={16} />
            <kbd>⌘ K</kbd>
          </button>
          <button
            className="studio-icon-button"
            aria-label={day ? "Use dark appearance" : "Use light appearance"}
            onClick={toggleAppearance}
          >
            {day ? <Moon size={19} /> : <Sun size={19} />}
          </button>
          <button
            className="studio-icon-button studio-mobile-menu"
            aria-label="Toggle documents"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            <List size={21} />
          </button>
        </div>
      </header>
      <div className="studio-body">
        {sidebarOpen && (
          <button
            className="studio-sidebar-scrim"
            aria-label="Close documents"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <aside className="studio-sidebar" aria-label="Documents">
          <div className="studio-workspace-heading">
            <span className="studio-workspace-icon">
              <FolderSimple size={18} />
            </span>
            <div>
              <strong>My workspace</strong>
              <span>Documents and reviewed sources</span>
            </div>
          </div>
          <button className="studio-import" onClick={importFiles}>
            <Plus size={17} /> Import files <span>↗</span>
          </button>
          <div className="studio-sidebar-label">
            <span>DOCUMENTS</span>
            <span>{studio.documents.length.toString().padStart(2, "0")}</span>
          </div>
          <div className="studio-document-list">
            {studio.documents.map((item) => (
              <div
                className={`studio-document-item${item.id === studio.selectedId ? " selected" : ""}`}
                key={item.id}
              >
                <button
                  onClick={() => {
                    studio.selectDocument(item.id);
                    changeView("read");
                    setSidebarOpen(false);
                  }}
                  aria-pressed={item.id === studio.selectedId}
                >
                  <FileText
                    size={19}
                    weight={
                      item.id === studio.selectedId ? "duotone" : "regular"
                    }
                  />
                  <span>
                    <strong>
                      {item.name
                        .replace(/\.(md|txt)$/i, "")
                        .replaceAll("-", " ")}
                    </strong>
                    <small>
                      {item.isExample
                        ? "Sample document"
                        : item.status === "ready"
                          ? "Reviewed"
                          : item.status === "loading"
                            ? "Extracting…"
                            : item.status === "error"
                              ? "Needs attention"
                              : "Ready to review"}
                    </small>
                  </span>
                  {item.status === "ready" ? (
                    <span className="studio-document-dot" />
                  ) : null}
                </button>
                <button
                  className="studio-document-remove"
                  aria-label={`Remove ${item.name}`}
                  onClick={() => {
                    studio.removeDocument(item.id);
                    announce("Document removed from this session.");
                  }}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
          {studio.canUndoRemove && (
            <button
              className="studio-new-document"
              onClick={() => {
                if (studio.restoreRemovedDocument())
                  announce("Document restored.");
              }}
            >
              <ArrowCounterClockwise size={16} /> Undo last removal
            </button>
          )}
          <button
            className="studio-new-document"
            onClick={() => setModal("new")}
          >
            <Plus size={16} /> New document
          </button>
          <div className="studio-sidebar-divider" />
          <div className="studio-sidebar-label">
            <span>TRY SOMETHING</span>
            <Sparkle size={13} />
          </div>
          <button
            className="studio-example"
            onClick={() => {
              void studio.loadExample("garden");
              changeView("read");
              setSidebarOpen(false);
            }}
          >
            <Leaf size={17} />
            <span>A plain-language example</span>
          </button>
          <button
            className="studio-example"
            onClick={() => {
              void studio.loadExample("research");
              changeView("read");
              setSidebarOpen(false);
            }}
          >
            <BookOpen size={17} />
            <span>A research abstract</span>
          </button>
          <button
            className="studio-example"
            onClick={() => {
              void studio.loadExample("email");
              changeView("read");
              setSidebarOpen(false);
            }}
          >
            <Article size={17} />
            <span>A professional email</span>
          </button>
          <div className="studio-sidebar-bottom">
            <div className="studio-privacy-note">
              <ShieldCheck size={20} />
              <strong>Processed in your browser.</strong>
              <p>
                Manual intake and review happen in this browser. Only an explicit
                local Run sends a reviewed snapshot to your host.
              </p>
            </div>
            <button
              className="studio-help-button"
              onClick={() => setModal("help")}
            >
              <BookOpen size={17} /> Workflow guide{" "}
              <ArrowUpRight size={13} />
            </button>
            <div className="studio-sidebar-footer">
              <span>SOURCE → REVIEW → EXPORT</span>
              <span>↳ rn.</span>
            </div>
          </div>
        </aside>
        <section
          className={`studio-main${mobilePanel === "brief" ? " mobile-hidden" : ""}`}
          aria-label="Document workspace"
        >
          <div className="studio-welcome">
            <div>
              <span className="studio-eyebrow">
                <span className="studio-live-dot" /> SOURCE-BASED REWRITING
              </span>
              <h1>
                Rewrite
                <br />
                <em>with control.</em>
              </h1>
            </div>
            <div className="studio-welcome-note">
              <span className="studio-editorial-symbol" aria-hidden="true">
                Aa<span>↗</span>
              </span>
              <p>
                Review your source.
                <br />
                Configure every rewrite.
              </p>
            </div>
          </div>
          <div className="studio-process" aria-label="Rewriting method">
            <span className={currentView !== "package" ? "active" : ""}>
              <span>01</span> Review source
            </span>
            <ArrowRight size={13} />
            <span>
              <span>02</span> Set requirements
            </span>
            <ArrowRight size={13} />
            <span className={currentView === "package" ? "active" : ""}>
              <span>03</span> Export prompts
            </span>
          </div>
          <div
            className="studio-editor-frame"
            id="studio-document"
            tabIndex={-1}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node))
                setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void studio.importFiles(Array.from(event.dataTransfer.files));
              changeView("read");
            }}
          >
            <div className="studio-editor-toolbar">
              <div className="studio-document-title">
                <FileText size={17} />
                <span>
                  {currentView === "package"
                    ? "Prompt workspace"
                    : (doc?.name ?? "A fresh page")}
                </span>
                {doc?.isExample && (
                  <span className="studio-sample-badge">SAMPLE</span>
                )}
              </div>
              <div className="studio-editor-tools">
                {focused && (
                  <span className="studio-focus-label">
                    Focus mode <kbd>Esc</kbd>
                  </span>
                )}
                <button
                  className="studio-icon-button"
                  aria-label={focused ? "Exit focus mode" : "Enter focus mode"}
                  aria-pressed={focused}
                  onClick={() => setFocused(!focused)}
                >
                  <SidebarSimple size={18} />
                </button>
                <button
                  className="studio-icon-button"
                  aria-label="Copy source text"
                  disabled={!doc}
                  onClick={() =>
                    void copyText(doc?.text ?? "").then((result) =>
                      announce(
                        result === "copied"
                          ? "Source copied to clipboard."
                          : "Clipboard unavailable. Use Edit to select the source.",
                      ),
                    )
                  }
                >
                  <Copy size={18} />
                </button>
              </div>
            </div>
            <div className="studio-view-tabs" aria-label="Document view">
              {(
                [
                  { id: "read", label: "Read", icon: BookOpen },
                  { id: "edit", label: "Edit source", icon: TextAa },
                  { id: "compare", label: "Compare", icon: Article },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  aria-pressed={currentView === item.id}
                  onClick={() => changeView(item.id)}
                >
                  <item.icon size={15} />
                  {item.label}
                </button>
              ))}
              <button
                aria-pressed={currentView === "package"}
                disabled={!built}
                onClick={() => changeView("package")}
              >
                <Sparkle size={15} /> Prompt package
                {built && <span className="studio-mini-dot" />}
              </button>
            </div>
            {dragging && (
              <div className="studio-drag-overlay">
                <UploadSimple size={42} />
                <strong>Drop source files.</strong>
                <span>TXT, Markdown, PDF, or DOCX</span>
              </div>
            )}
            {built && (
              <div
                key={studio.packageGeneration}
                hidden={currentView !== "package"}
                className="studio-persistent-package"
              >
                {packageIsStale && (
                  <div className="studio-snapshot-notice" role="status">
                    <strong>Previous package retained.</strong>
                    <p>
                      Your workspace has changed. These prompts and responses
                      belong to the earlier source and brief. Save your progress
                      and edited results before building an updated package.
                    </p>
                  </div>
                )}
                <div className="studio-package-document-picker">
                  {built.workbooks.length > 1 && (
                    <label>
                      Package document{" "}
                      <select
                        value={packageDocument}
                        onChange={(event) =>
                          setPackageDocument(Number(event.target.value))
                        }
                      >
                        {built.workbooks.map((workbook, index) => (
                          <option key={workbook.documentKey} value={index}>
                            {workbook.originalDisplayName}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                {built.workbooks.map((workbook, index) => (
                  <div
                    hidden={index !== packageDocument}
                    key={workbook.documentKey}
                  >
                    <StudioPackage
                      workbook={workbook}
                      sourceText={
                        builtSources[workbook.documentKey]?.text ?? ""
                      }
                      demoResponse={
                        builtSources[workbook.documentKey]?.isExample
                          ? studioDemoResponse(workbook.originalDisplayName)
                          : undefined
                      }
                      onDownload={studio.downloadPackage}
                    />
                  </div>
                ))}
              </div>
            )}
            {!doc ? (
              <div className="studio-empty">
                <span className="studio-empty-letter">
                  a<span>↗</span>
                </span>
                <h2>
                  Every good rewrite
                  <br />
                  starts somewhere.
                </h2>
                <p>
                  Drop a document, paste your words,
                  <br />
                  or take one of our samples for a spin.
                </p>
                <button className="studio-primary" onClick={importFiles}>
                  <Plus size={17} /> Import your first file
                </button>
                <button
                  className="studio-text-button"
                  onClick={() => setModal("new")}
                >
                  Or start with a blank page <ArrowRight size={15} />
                </button>
              </div>
            ) : currentView === "package" && built ? null : (
              <>
                {doc.status === "loading" ? (
                  <div className="studio-extracting">
                    <span className="studio-spinner" />
                    <h2>Extracting source…</h2>
                    <p>Extracting your document, right here in your browser.</p>
                  </div>
                ) : doc.status === "error" ? (
                  <div className="studio-empty">
                    <h2>Unable to import source.</h2>
                    <p>{doc.error}</p>
                    <button className="studio-primary" onClick={importFiles}>
                      Choose a file
                    </button>
                  </div>
                ) : currentView === "read" ? (
                  <article className="studio-paper">
                    <div className="studio-paper-meta">
                      <span>
                        {doc.isExample
                          ? "THE SAMPLE LIBRARY"
                          : doc.text === doc.originalText ? "ORIGINAL SOURCE" : "REVIEWED SOURCE"}
                      </span>
                      <span>
                        {Math.max(1, Math.ceil(words / 225))} MIN READ
                      </span>
                    </div>
                    <div className="studio-prose">
                      {!["text", "markdown", "docx", "pdf"].includes(doc.format) ? <pre className="studio-code-source">{doc.text.slice(0, 50000)}</pre> : <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          a: ({ children }) => (
                            <span className="studio-source-link">
                              {children}
                            </span>
                          ),
                          img: ({ alt }) => (
                            <span className="studio-source-image">
                              [Image: {alt || "source image"}]
                            </span>
                          ),
                        }}
                      >
                        {doc.text.slice(0, 50000) ||
                          "*Choose Edit source to enter text.*"}
                      </ReactMarkdown>}
                    </div>
                    {doc.text.length > 50000 && (
                      <p className="studio-preview-limit">
                        This reading preview shows the first 50,000 characters.
                        Your complete source is available in Edit source and
                        included in the package.
                      </p>
                    )}
                    <div className="studio-paper-end">
                      <span />◆<span />
                    </div>
                  </article>
                ) : currentView === "edit" ? (
                  <div className="studio-edit-area">
                    <div className="studio-edit-notice">
                      <TextAa size={16} />
                      <span>
                        Edit freely. Your original stays in the package.
                      </span>
                    </div>
                    <textarea
                      className="studio-source-editor"
                      aria-label="Document source"
                      spellCheck
                      value={doc.text}
                      onChange={(event) =>
                        studio.updateText(event.target.value)
                      }
                    />
                  </div>
                ) : (
                  <CompareView
                    originalText={doc.originalText}
                    text={doc.text}
                  />
                )}
                {doc.warnings.length > 0 && !doc.isExample && (
                  <details className="studio-source-notes">
                    <summary>
                      Source notes <span>{doc.warnings.length}</span>
                    </summary>
                    <ul>
                      {doc.warnings.map((warning, index) => (
                        <li key={index}>{warning}</li>
                      ))}
                    </ul>
                  </details>
                )}
                <div className="studio-document-status">
                  <div>
                    <span>
                      <strong>{words.toLocaleString()}</strong> words
                    </span>
                    <span className="studio-status-divider" />
                    <span>{doc.text.length.toLocaleString()} characters</span>
                  </div>
                  {doc.status === "ready" ? (
                    <span className="studio-reviewed">
                      <CheckCircle size={15} /> Source reviewed
                    </span>
                  ) : doc.status === "review" ? (
                    <button
                      className="studio-review-button"
                      onClick={studio.confirmReview}
                    >
                      <Check size={15} /> Review complete
                    </button>
                  ) : null}
                </div>
              </>
            )}
          </div>
          {studio.error && (
            <div className="studio-error" role="alert">
              <span>{studio.error}</span>
              <button
                className="studio-icon-button"
                aria-label="Dismiss error"
                onClick={studio.clearError}
              >
                <X size={16} />
              </button>
            </div>
          )}
          <div className="studio-workspace-footnote">
            <ShieldCheck size={13} />
            <span>
              Edits stay in this tab. Export to keep them; an explicit local Run
              also preserves its frozen snapshot in a job folder.
            </span>
            <button onClick={() => setModal("help")}>
              How it works <ArrowUpRight size={12} />
            </button>
          </div>
        </section>
        <aside
          className={`studio-inspector${mobilePanel === "document" ? " mobile-hidden" : ""}`}
          aria-label="Writing controls"
        >
          <div className="studio-inspector-tabs">
            <button
              aria-pressed={inspector === "brief"}
              onClick={() => setInspector("brief")}
            >
              <SlidersHorizontal size={16} /> Writing brief
            </button>
            <button
              aria-pressed={inspector === "insights"}
              onClick={() => setInspector("insights")}
            >
              <Lightbulb size={16} /> Insights
            </button>
          </div>
          {inspector === "insights" ? (
            <StudioInsights
              text={doc?.text ?? ""}
              originalText={doc?.originalText ?? ""}
            />
          ) : (
            <div className="studio-brief">
              <div className="studio-brief-intro">
                <span className="studio-eyebrow">REWRITE CONFIGURATION</span>
                <h2>Rewrite settings</h2>
                <p>Set tone, length, and constraints.</p>
              </div>
              <div className="studio-recipes" aria-label="Writing presets">
                {recipes.map((recipe) => (
                  <button
                    key={recipe.id}
                    aria-pressed={activeRecipe?.id === recipe.id}
                    onClick={() => studio.updateSettings(recipe.settings)}
                  >
                    <span className="studio-recipe-icon">
                      <recipe.icon size={20} />
                    </span>
                    <span>
                      <strong>{recipe.label}</strong>
                      <small>{recipe.description}</small>
                    </span>
                    {activeRecipe?.id === recipe.id ? (
                      <CheckCircle size={16} weight="fill" />
                    ) : (
                      <Circle size={16} />
                    )}
                  </button>
                ))}
              </div>
              <Field label="TONE OF VOICE">
                <div className="studio-tone-options">
                  {tones.map((tone) => (
                    <button
                      key={tone.id}
                      aria-pressed={studio.settings.tone === tone.id}
                      onClick={() => studio.updateSettings({ tone: tone.id })}
                    >
                      {tone.label}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="LENGTH">
                <div className="studio-segmented">
                  {(
                    [
                      { id: "concise", label: "Shorter" },
                      { id: "preserve", label: "As written" },
                      { id: "expanded", label: "Longer" },
                    ] as const
                  ).map((length) => (
                    <button
                      key={length.id}
                      aria-pressed={studio.settings.length === length.id}
                      onClick={() =>
                        studio.updateSettings({ length: length.id })
                      }
                    >
                      {length.label}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="PROMPT GUIDANCE">
                <div className="studio-select-wrap">
                  <Sparkle size={17} />
                  <select
                    aria-label="Model profile"
                    value={studio.profile.id}
                    onChange={(event) =>
                      studio.selectProfile(event.target.value)
                    }
                  >
                    {studio.profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.label}
                      </option>
                    ))}
                  </select>
                  <CaretDown size={14} />
                </div>
                <p className="studio-field-help">
                  Optional family/style guidance. Execution model is selected separately in Runs.
                </p>
              </Field>
              <details className="studio-advanced">
                <summary>
                  Fine-tune the details <Plus size={15} />
                </summary>
                <label>
                  Formality
                  <select
                    value={studio.settings.formality}
                    onChange={(event) =>
                      studio.updateSettings({
                        formality: event.target
                          .value as RewriteSettings["formality"],
                      })
                    }
                  >
                    <option value="preserve">Keep the original</option>
                    <option value="standard">Natural</option>
                    <option value="formal">Formal</option>
                  </select>
                </label>
                <label>
                  Output language
                  <input
                    value={studio.settings.outputLanguage}
                    onChange={(event) =>
                      studio.updateSettings({
                        outputLanguage: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Anything to keep in mind?
                  <textarea
                    maxLength={2000}
                    placeholder="Keep technical terms. Use British English…"
                    value={studio.settings.customRequirements}
                    onChange={(event) =>
                      studio.updateSettings({
                        customRequirements: event.target.value,
                      })
                    }
                  />
                </label>
              </details>
              <div className="studio-contract">
                <ShieldCheck size={17} />
                <div>
                  <strong>New expression. Original meaning.</strong>
                  <p>
                    Every workflow asks your model to preserve facts, verify
                    changes, and resolve issues.
                  </p>
                </div>
              </div>
            </div>
          )}
          <div className="studio-build-area">
            {studio.contextAssessment.acknowledgmentRequired &&
              !studio.contextWarningAcknowledged && (
                <div className="studio-context-warning">
                  <strong>This source is a long read.</strong>
                  <p>
                    The estimated workflow exceeds this profile’s context
                    window. A larger context or a smaller source may work
                    better.
                  </p>
                  <button
                    className="studio-secondary"
                    onClick={studio.acknowledgeContextWarning}
                  >
                    I understand — allow export
                  </button>
                </div>
              )}
            <div className="studio-build-context">
              <span>
                {packageIsStale
                  ? "WORKSPACE UPDATED"
                  : built
                    ? "PACKAGE READY"
                    : doc?.status === "ready"
                      ? "READY WHEN YOU ARE"
                      : "REVIEW YOUR SOURCE"}
              </span>
              <span>
                {studio.documents.length}{" "}
                {studio.documents.length === 1 ? "document" : "documents"}
              </span>
            </div>
            <button
              className="studio-primary studio-build-button"
              onClick={() => {
                if (built && !packageIsStale) {
                  changeView("package");
                } else {
                  void build();
                }
              }}
              disabled={
                studio.building ||
                ((!built || packageIsStale) && Boolean(studio.exportBlocker))
              }
            >
              {studio.building ? (
                <>
                  <span className="studio-spinner" /> Preparing your package…
                </>
              ) : built && !packageIsStale ? (
                <>
                  <CheckCircle size={19} /> Open prompt package{" "}
                  <ArrowRight size={17} />
                </>
              ) : (
                <>
                  <MagicWand size={19} />{" "}
                  {packageIsStale ? "Build updated package" : "Build package"}{" "}
                  <ArrowRight size={17} />
                </>
              )}
            </button>
            {studio.exportBlocker && (!built || packageIsStale) ? (
              <p className="studio-build-hint">{studio.exportBlocker}</p>
            ) : (
              <p className="studio-build-hint">
                {packageIsStale
                  ? "Your previous package and responses remain in the Package tab."
                  : built
                    ? "Your package stays available while you revise your workspace."
                    : "One-shot + four stages. Ready for your model."}
              </p>
            )}
            {built && (
              <button
                className="studio-text-button"
                onClick={studio.downloadPackage}
              >
                <DownloadSimple size={15} />{" "}
                {packageIsStale ? "Download previous ZIP" : "Download ZIP"}
              </button>
            )}
            {studio.promptBundle && (
              <button
                className="studio-preview-prompt"
                onClick={() => setShowPrompt(true)}
              >
                Inspect prompt <ArrowUpRight size={12} />
              </button>
            )}
          </div>
        </aside>
      </div>
      <nav className="studio-mobile-tabs" aria-label="Studio panels">
        <button
          aria-pressed={mobilePanel === "document"}
          onClick={() => setMobilePanel("document")}
        >
          <FileText size={18} />
          Document
        </button>
        <button
          aria-pressed={mobilePanel === "brief"}
          onClick={() => {
            setFocused(false);
            setMobilePanel("brief");
          }}
        >
          <SlidersHorizontal size={18} />
          Brief & insights
        </button>
        <button
          onClick={() => {
            if (built) changeView("package");
            else {
              setFocused(false);
              setMobilePanel("brief");
            }
          }}
        >
          <Sparkle size={18} />
          Package{built && <span className="studio-mini-dot" />}
        </button>
      </nav>
      {toast && (
        <div className="studio-toast" role="status">
          <CheckCircle size={18} />
          {toast}
          {toast === "Document removed from this session." &&
            studio.canUndoRemove && (
              <button
                onClick={() => {
                  if (studio.restoreRemovedDocument())
                    announce("Document restored.");
                }}
              >
                Undo
              </button>
            )}
        </div>
      )}
      {showPrompt && (
        <StudioDialog
          title="Your prompt, in plain sight."
          onClose={() => setShowPrompt(false)}
          className="studio-preview-dialog"
        >
          <p>
            This live preview changes with your source and brief. Review the
            source before building your final package.
          </p>
          <textarea
            readOnly
            aria-label="Live prompt preview"
            value={studio.promptBundle?.oneShot ?? ""}
          />
          <div className="studio-dialog-actions">
            <button
              className="studio-primary"
              onClick={() => {
                setShowPrompt(false);
                void build();
              }}
              disabled={Boolean(studio.exportBlocker)}
            >
              Build package <ArrowRight size={16} />
            </button>
          </div>
        </StudioDialog>
      )}
      {modal === "replace" && (
        <StudioDialog
          title="Ready for a fresh package?"
          onClose={() => setModal(null)}
        >
          <p>
            This replaces the previous package workspace, including its pasted
            responses and edited results. Your source documents stay in the
            studio.
          </p>
          <p>
            Save a progress HTML copy for responses, and download any edited
            result as Markdown before continuing.
          </p>
          <div className="studio-dialog-actions">
            <button
              className="studio-secondary"
              onClick={() => {
                setModal(null);
                changeView("package");
              }}
            >
              Back to previous package
            </button>
            <button
              className="studio-primary"
              onClick={() => {
                setModal(null);
                void build(true);
              }}
              disabled={Boolean(studio.exportBlocker)}
            >
              Replace package <ArrowRight size={16} />
            </button>
          </div>
        </StudioDialog>
      )}
      {modal === "new" && (
        <StudioDialog
          title="Create a document"
          onClose={() => setModal(null)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const added = studio.addTextDocument(newText, newName);
              if (!added) return;
              setSidebarOpen(false);
              setNewText("");
              setNewName("Untitled.md");
              setModal(null);
              changeView("edit");
            }}
          >
            <label className="studio-form-label">
              DOCUMENT NAME
              <input
                autoFocus
                required
                maxLength={120}
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
              />
            </label>
            <label className="studio-form-label">
              YOUR WORDS
              <textarea
                placeholder="Paste a paragraph, an article, that email you’ve been overthinking…"
                value={newText}
                onChange={(event) => setNewText(event.target.value)}
              />
            </label>
            {studio.error && (
              <p className="studio-error" role="alert">
                {studio.error}
              </p>
            )}
            <div className="studio-dialog-actions">
              <span>
                <ShieldCheck size={14} /> Stored in this tab’s memory.
              </span>
              <button className="studio-primary" type="submit">
                Create document <ArrowRight size={16} />
              </button>
            </div>
          </form>
        </StudioDialog>
      )}
      {modal === "help" && (
        <StudioDialog
          title="Workflow guide."
          onClose={() => setModal(null)}
          className="studio-guide"
        >
          <p className="studio-guide-lede">
            Source to final.
            <br />
            <em>Review every stage.</em>
          </p>
          <p>
            reword-nerd turns your source and writing brief into portable
            prompts. You choose the model, run the prompts, and bring its
            responses back.
          </p>
          <ol>
            <li>
              <span>01</span>
              <div>
                <h3>Review the original source.</h3>
                <p>
                  Import TXT, Markdown, DOCX, or PDF, or paste a new document.
                  Check the extracted text and mark it reviewed.
                </p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Configure the rewrite.</h3>
                <p>
                  Pick a preset, tune the tone and length, and choose your model
                  profile. Your brief is included in every prompt.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Run and review.</h3>
                <p>
                  Build the package. Copy a one-shot prompt, or use Decompose →
                  Rewrite → Verify → Final, pasting each model response back
                  into the guided workflow.
                </p>
              </div>
            </li>
          </ol>
          <div className="studio-guide-note">
            <ShieldCheck size={24} />
            <p>
              There are no model calls or document uploads here. Source
              documents, responses, and drafts live in memory for this tab.
              Download your ZIP, response progress, and edited Markdown to keep
              your work.
            </p>
          </div>
          <p className="studio-field-help">
            Use Images for reference-image packages, Projects for folders and ZIPs,
            or Advanced sources & OCR for detailed extraction controls. Runs explains the local text companion.
          </p>
          <button className="studio-primary" onClick={() => setModal(null)}>
            Return to workspace <ArrowRight size={16} />
          </button>
        </StudioDialog>
      )}
      {modal === "commands" && (
        <StudioDialog
          title="Where to?"
          onClose={() => {
            setModal(null);
            setCommandQuery("");
          }}
          className="studio-command-dialog"
        >
          <div className="studio-command-search">
            <MagnifyingGlass size={20} />
            <input
              autoFocus
              aria-label="Search commands"
              value={commandQuery}
              onChange={(event) => setCommandQuery(event.target.value)}
              placeholder="Search commands…"
            />
          </div>
          <div className="studio-command-list">
            {commands.map((command) => (
              <button
                key={command.label}
                onClick={() => {
                  runCommand(command.id);
                }}
              >
                <command.icon size={20} />
                <span>
                  <strong>{command.label}</strong>
                  <small>{command.hint}</small>
                </span>
                <ArrowRight size={16} />
              </button>
            ))}
            {commands.length === 0 && (
              <p>No matches. Try “import” or “focus”.</p>
            )}
          </div>
          <div className="studio-command-footer">
            <Command size={13} />
            <span>K to open</span>
            <span>ESC to close</span>
          </div>
        </StudioDialog>
      )}
    </main>
  );
}
