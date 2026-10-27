import { useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  FileText,
  Leaf,
  ShieldCheck,
} from "@phosphor-icons/react";
import { countWords } from "./textInsights";
import "./welcome.css";
import { useAppearance, AppearanceControls } from "../platform/appearance";

const examples = [
  {
    id: "clarity",
    label: "Clarity",
    note: "Shorter wording. Same statement.",
    original:
      "At this point in time, we are in the process of considering a number of different options.",
    revised: "We’re considering our options.",
  },
  {
    id: "professional",
    label: "Professional",
    note: "Direct wording for professional communication.",
    original:
      "Hey, just checking if you got a chance to look at the proposal I sent over last week.",
    revised: "Have you had a chance to review the proposal I sent last week?",
  },
  {
    id: "academic",
    label: "Academic",
    note: "Clearer expression. Careful with the claim.",
    original:
      "The study found that people slept better when they spent less time on their phones before bed.",
    revised:
      "The study found an association between reduced phone use before bedtime and improved sleep.",
  },
] as const;

const stages = [
  {
    number: "01",
    name: "Decompose",
    text: "Map the claims, terms, and structure before changing a word.",
  },
  {
    number: "02",
    name: "Rewrite",
    text: "Give your model a clear brief for a new expression of the same ideas.",
  },
  {
    number: "03",
    name: "Verify",
    text: "Ask it to check facts, omissions, and shifts in meaning.",
  },
  {
    number: "04",
    name: "Final",
    text: "Resolve the issues it flags. Produce the final document.",
  },
];

function WelcomeBrand() {
  return (
    <span className="welcome-brand">
      <span className="welcome-brand-mark" aria-hidden="true">
        <span>r</span>
        <span>n</span>
      </span>
      <span>
        reword<span className="welcome-brand-accent">_</span>nerd
        <span className="welcome-brand-accent">.</span>
      </span>
    </span>
  );
}

export function StudioWelcome() {
  const [exampleIndex, setExampleIndex] = useState(0);
  const appearance = useAppearance();
  const light = appearance.mode === "light";
  const [showOriginal, setShowOriginal] = useState(true);
  const example = examples[exampleIndex];
  const originalCount = countWords(example.original);
  const revisedCount = countWords(example.revised);
  return (
    <div
      className={`unified-platform studio-welcome-page${light ? " welcome-light" : ""}`}
      data-palette={appearance.palette}
      data-appearance={appearance.mode}
      id="welcome-top"
    >
      <a className="welcome-skip" href="#welcome-content">
        Skip to content
      </a>
      <header className="welcome-masthead welcome-container">
        <a
          className="welcome-home-link"
          href="#welcome-top"
          aria-label="reword-nerd home"
        >
          <WelcomeBrand />
        </a>
        <nav
          className="welcome-navigation"
          aria-label="Introduction navigation"
        >
          <a href="#welcome-method">The method</a>
          <a href="#welcome-privacy">Your privacy</a>
        </nav>
        <div className="welcome-header-actions">
          <AppearanceControls {...appearance} />
          <a className="welcome-header-cta" href="./">
            Open studio <ArrowUpRight size={17} aria-hidden="true" />
          </a>
        </div>
      </header>

      <main id="welcome-content" tabIndex={-1}>
        <section
          className="welcome-hero welcome-container"
          aria-labelledby="welcome-heading"
        >
          <div className="welcome-hero-copy">
            <h1 id="welcome-heading">
              Rewrite
              <br />
              <em>with control.</em>
            </h1>
            <p>
              Review documents, image references and project sources. Configure
              the rewrite and export prompts for your chosen model.
            </p>
            <p className="welcome-hero-subcopy">
              Original sources. Explicit constraints. Reviewable results.
            </p>
            <div className="welcome-hero-actions">
              <a className="welcome-button" href="./">
                Open the writing studio{" "}
                <ArrowUpRight size={19} aria-hidden="true" />
              </a>
              <span>
                <ShieldCheck size={15} aria-hidden="true" /> Local. Private.
                Yours.
              </span>
            </div>
          </div>
          <div className="welcome-demo">
            <div className="welcome-demo-controls">
              <span>COMPARE REWRITE SETTINGS</span>
              <div role="group" aria-label="Illustrative writing examples">
                {examples.map((item, index) => (
                  <button
                    type="button"
                    key={item.id}
                    aria-pressed={exampleIndex === index}
                    onClick={() => setExampleIndex(index)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="welcome-writing-sheet">
              <div className="welcome-sheet-topline">
                <span>ILLUSTRATIVE REWRITE</span>
                <span className="welcome-sheet-symbol" aria-hidden="true">
                  Aa<span>↗</span>
                </span>
              </div>
              <div
                className="welcome-example-content"
                key={`${example.id}-${showOriginal}`}
              >
                {showOriginal && (
                  <div className="welcome-before">
                    <span className="welcome-sheet-label">Before</span>
                    <p>{example.original}</p>
                  </div>
                )}
                <div className="welcome-sheet-divider">
                  <span />
                  <ArrowDown size={18} aria-hidden="true" />
                  <span />
                </div>
                <div className="welcome-after">
                  <span className="welcome-sheet-label">
                    After · {example.label.toLowerCase()}
                  </span>
                  <p>{example.revised}</p>
                </div>
              </div>
              <div className="welcome-sheet-footer">
                <span>
                  {originalCount} <ArrowRight size={12} aria-hidden="true" />
                  <span className="welcome-visually-hidden">to</span>{" "}
                  {revisedCount} words
                </span>
                <button
                  type="button"
                  aria-pressed={showOriginal}
                  onClick={() => setShowOriginal(!showOriginal)}
                >
                  {showOriginal ? "Hide original" : "Show original"}
                </button>
              </div>
            </div>
            <div className="welcome-demo-caption">
              <p>{example.note}</p>
              <span>Prewritten examples. No model call.</span>
            </div>
          </div>
          <div className="welcome-hero-bottom">
            <span>LOCAL SOURCE REVIEW</span>
            <a href="#welcome-method">
              Inspect the four-stage workflow{" "}
              <ArrowDown size={14} aria-hidden="true" />
            </a>
          </div>
        </section>

        <section
          className="welcome-method"
          id="welcome-method"
          aria-labelledby="welcome-method-title"
        >
          <div className="welcome-container">
            <div className="welcome-section-intro">
              <div>
                <span className="welcome-section-label">THE METHOD</span>
                <h2 id="welcome-method-title">
                  Decompose. Rewrite.
                  <br />
                  Verify. Final.
                </h2>
              </div>
              <p>
                Use one prompt or four separate stages. Both paths include your
                reviewed source and requirements, ready for your chosen model.
              </p>
            </div>
            <ol className="welcome-stages">
              {stages.map((stage, index) => (
                <li key={stage.number}>
                  <div className="welcome-stage-marker">
                    <span>{stage.number}</span>
                    {index < stages.length - 1 ? (
                      <ArrowRight size={16} aria-hidden="true" />
                    ) : (
                      <Check size={17} aria-hidden="true" />
                    )}
                  </div>
                  <h3>{stage.name}</h3>
                  <p>{stage.text}</p>
                </li>
              ))}
            </ol>
            <div className="welcome-method-note">
              <Leaf size={18} aria-hidden="true" />
              <span>
                The workflow asks your model to preserve the substance. You
                decide whether it did.
              </span>
            </div>
          </div>
        </section>

        <section
          className="welcome-workspace"
          aria-labelledby="welcome-workspace-title"
        >
          <div className="welcome-container">
            <div className="welcome-section-intro">
              <div>
                <span className="welcome-section-label">
                  MEET YOUR WRITING STUDIO
                </span>
                <h2 id="welcome-workspace-title">
                  One workspace.
                  <br />
                  Every source.
                </h2>
              </div>
              <div className="welcome-workspace-description">
                <p>
                  Review sources, compare edits, configure prompts and export
                  packages. Switch between Text, Images and Projects without
                  resetting your session.
                </p>
                <a href="./">
                  Open the workspace{" "}
                  <ArrowUpRight size={17} aria-hidden="true" />
                </a>
              </div>
            </div>
            <figure className="welcome-workspace-figure">
              <img
                src={`${import.meta.env.BASE_URL}studio/workspace-preview.png`}
                alt="The reword-nerd writing studio showing a source document beside writing brief controls, with documents on the left."
                width={1440}
                height={900}
                loading="lazy"
              />
              <figcaption>
                <span>
                  <span className="welcome-caption-dot" />
                  APPROVED STUDIO DESIGN
                </span>
                <span>
                  Original green palette shown; colors are selectable in the workspace.
                </span>
              </figcaption>
            </figure>
            <div className="welcome-capabilities">
              <span>
                <FileText size={17} aria-hidden="true" />
                TXT, Markdown, PDF & DOCX
              </span>
              <span>Readability & sentence rhythm</span>
              <span>Original-to-edit comparison</span>
              <span>Downloadable prompt packages</span>
            </div>
          </div>
        </section>

        <section
          className="welcome-privacy welcome-container"
          id="welcome-privacy"
          aria-labelledby="welcome-privacy-title"
        >
          <div className="welcome-privacy-heading">
            <ShieldCheck size={34} weight="light" aria-hidden="true" />
            <h2 id="welcome-privacy-title">
              Your source.
              <br />
              Your browser.
              <br />
              <em>Your review.</em>
            </h2>
          </div>
          <div className="welcome-privacy-details">
            <div>
              <h3>A workspace on your device.</h3>
              <p>
                Your files are processed in your browser. There’s no account to
                create and no document upload to a server.
              </p>
            </div>
            <div>
              <h3>You choose what leaves.</h3>
              <p>
                Review and download your package, then take it to your chosen
                model. The studio makes no model calls.
              </p>
            </div>
            <div>
              <h3>Keep a copy before you go.</h3>
              <p>
                Enable workspace remembering to recover your documents and
                response progress after reload. Export a workspace file or
                download your package for a portable copy.
              </p>
            </div>
          </div>
        </section>

        <section
          className="welcome-finale"
          aria-labelledby="welcome-finale-title"
        >
          <div className="welcome-container">
            <span className="welcome-finale-flourish" aria-hidden="true">
              ↳
            </span>
            <h2 id="welcome-finale-title">
              Review the source.
              <br />
              <em>Control the rewrite.</em>
            </h2>
            <p>Set requirements. Build the package. Review the result.</p>
            <a className="welcome-button" href="./">
              Open workspace{" "}
              <ArrowUpRight size={20} aria-hidden="true" />
            </a>
          </div>
        </section>
      </main>
      <footer className="welcome-footer welcome-container">
        <a href="#welcome-top" aria-label="Back to top">
          <WelcomeBrand />
        </a>
        <span>A local-first writing studio.</span>
        <span>
          SOURCE → REVIEW → EXPORT <span aria-hidden="true">↳</span>
        </span>
      </footer>
    </div>
  );
}
