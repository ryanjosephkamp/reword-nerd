import { useMemo, useState } from "react";
import { ArrowRight, ChartBar, CheckCircle, Clock, Info, Minus, Plus, TextAlignLeft } from "@phosphor-icons/react";
import { analyzeText, countWords, createWordDiff, formatReadingTime, MAX_ANALYSIS_CHARACTERS, MAX_COMPARISON_PREVIEW_CHARACTERS } from "./textInsights";
import type { DiffChunk } from "./textInsights";
import "./insights.css";

export type StudioTextProps = { text: string; originalText: string };
export type StudioComparisonProps = StudioTextProps & { originalLabel?: string; resultLabel?: string };

export function StudioInsights({ text, originalText }: StudioTextProps) {
  const insights = useMemo(() => analyzeText(text), [text]);
  const originalWordCount = useMemo(() => countWords(originalText.slice(0, MAX_ANALYSIS_CHARACTERS)), [originalText]);
  const wordDelta = insights.wordCount - originalWordCount;
  const canCompareCounts = !insights.sampled && originalText.length <= MAX_ANALYSIS_CHARACTERS;
  const rhythm = insights.sentenceLengths.slice(0, 32);
  const maxSentence = Math.max(30, ...rhythm);
  const hasText = insights.wordCount > 0;

  return (
    <aside className="studio-insights" aria-label="Writing insights">
      <div className="studio-insights-heading">
        <span className="studio-insights-eyebrow"><ChartBar size={15} weight="bold" aria-hidden="true" /> THE BIG PICTURE</span>
        <span className="studio-insights-live"><span /> Live</span>
      </div>
      <h2 className="studio-insights-title">Your words, decoded.</h2>
      <p className="studio-insights-intro">A little perspective on the page.</p>
      {insights.sampled && <p className="studio-insights-sample-note">Large document: these insights describe the first {insights.analyzedCharacters.toLocaleString()} characters.</p>}

      <div className="studio-insights-metrics">
        <div className="studio-insights-metric">
          <span className="studio-insights-metric-label"><TextAlignLeft size={14} aria-hidden="true" /> Words</span>
          <strong>{insights.wordCount.toLocaleString()}</strong>
          <span className="studio-insights-metric-note">
            {canCompareCounts && text !== originalText && originalText.length > 0 && wordDelta !== 0 ? `${wordDelta > 0 ? "+" : ""}${wordDelta.toLocaleString()} from original` : `${insights.characterCount.toLocaleString()} characters`}
          </span>
        </div>
        <div className="studio-insights-metric">
          <span className="studio-insights-metric-label"><Clock size={14} aria-hidden="true" /> Read time</span>
          <strong>{formatReadingTime(insights.readingSeconds)}</strong>
          <span className="studio-insights-metric-note">At ~200 words / min</span>
        </div>
        <div className="studio-insights-metric">
          <span className="studio-insights-metric-label">Words / sentence</span>
          <strong>{hasText ? insights.averageSentenceWords.toFixed(1) : "—"}</strong>
          <span className="studio-insights-metric-note">Average length</span>
        </div>
        <div className="studio-insights-metric">
          <span className="studio-insights-metric-label">Paragraphs</span>
          <strong>{insights.paragraphCount}</strong>
          <span className="studio-insights-metric-note">{insights.sentenceCount} {insights.sentenceCount === 1 ? "sentence" : "sentences"} total</span>
        </div>
      </div>

      <div className="studio-insights-readability">
        <div className="studio-insights-section-heading"><h3>Reading ease</h3><span>English estimate</span></div>
        <div className="studio-insights-score">
          <strong>{insights.readingEase ?? "—"}<span> / 100</span></strong>
          <span>{insights.readabilityLabel}</span>
        </div>
        <div className="studio-insights-meter" role={insights.readingEase === null ? undefined : "meter"} aria-label="Estimated English reading ease" aria-valuemin={0} aria-valuemax={100} aria-valuenow={insights.readingEase ?? undefined}>
          <span style={{ width: `${insights.readingEase ?? 0}%` }} />
        </div>
        <div className="studio-insights-scale"><span>More demanding</span><span>More accessible</span></div>
      </div>

      <div className="studio-insights-rhythm">
        <div className="studio-insights-section-heading"><h3>Sentence rhythm</h3><span>Words per sentence</span></div>
        <div className={`studio-insights-sparkbars${!rhythm.length ? " is-empty" : ""}`} role="img" aria-label={rhythm.length ? `Words per sentence, first ${rhythm.length} sentences: ${rhythm.map((length, index) => `${index + 1}: ${length}`).join("; ")}.` : "Sentence rhythm appears when text is added"}>
          {rhythm.length ? rhythm.map((length, index) => (
            <span key={index} className={length > 25 ? "is-long" : length <= 12 ? "is-short" : "is-medium"} style={{ height: `${Math.max(7, length / maxSentence * 100)}%` }} title={`Sentence ${index + 1}: ${length} words`} aria-label={`Sentence ${index + 1}: ${length} words`} />
          )) : <span className="studio-insights-rhythm-empty">A rhythm starts with a sentence.</span>}
        </div>
        <div className="studio-insights-distribution">
          <span><i className="is-short" />Short <b>{insights.distribution.short}</b></span>
          <span><i className="is-medium" />Medium <b>{insights.distribution.medium}</b></span>
          <span><i className="is-long" />Long <b>{insights.distribution.long}</b></span>
        </div>
        <p className="studio-insights-chart-note">Short: 1–12 · Medium: 13–25 · Long: 26+{insights.sentenceCount > 32 ? " · First 32 shown" : ""}</p>
      </div>

      <div className="studio-insights-observations">
        <div className="studio-insights-section-heading"><h3>A fresh set of eyes</h3><span>{insights.observations.length} {insights.observations.length === 1 ? "note" : "notes"}</span></div>
        {insights.observations.map((observation) => (
          <div className={`studio-insights-observation is-${observation.tone}`} key={observation.title}>
            <span className="studio-insights-observation-icon">{observation.tone === "good" ? <CheckCircle size={17} weight="duotone" aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}</span>
            <div><h4>{observation.title}</h4><p>{observation.description}</p></div>
          </div>
        ))}
      </div>

      <details className="studio-insights-method">
        <summary><Info size={13} aria-hidden="true" /> How these numbers work</summary>
        <p>Everything is calculated on your device. Reading ease uses the Flesch formula with estimated English syllables; a higher score suggests simpler wording. It is a guide to sentence structure, not a judgment of your ideas or accuracy. Scores need at least 30 words. Word counts group letters and numbers, including internal apostrophes and hyphens. Blank lines separate paragraphs.</p>
      </details>
    </aside>
  );
}

function DiffText({ chunks, side }: { chunks: DiffChunk[]; side: "inline" | "original" | "edited" }) {
  return chunks.map((chunk, index) => {
    if ((side === "original" && chunk.kind === "insert") || (side === "edited" && chunk.kind === "delete")) return null;
    if (chunk.kind === "insert") return <ins key={index}>{chunk.text}</ins>;
    if (chunk.kind === "delete") return <del key={index}>{chunk.text}</del>;
    return <span key={index}>{chunk.text}</span>;
  });
}

export function CompareView({ originalText, text, originalLabel = "Original", resultLabel = "Your draft" }: StudioComparisonProps) {
  const [layout, setLayout] = useState<"inline" | "split">("inline");
  const previewOriginal = originalText.slice(0, MAX_COMPARISON_PREVIEW_CHARACTERS);
  const previewText = text.slice(0, MAX_COMPARISON_PREVIEW_CHARACTERS);
  const previewTruncated = originalText.length > MAX_COMPARISON_PREVIEW_CHARACTERS || text.length > MAX_COMPARISON_PREVIEW_CHARACTERS;
  const diff = useMemo(() => createWordDiff(previewOriginal, previewText), [previewOriginal, previewText]);
  const changed = originalText !== text;
  return (
    <section className="studio-compare" aria-label={originalLabel === "Original" && resultLabel === "Your draft" ? "Compare original and edited text" : `Compare ${originalLabel.toLocaleLowerCase()} and ${resultLabel.toLocaleLowerCase()}`}>
      <div className="studio-compare-toolbar">
        <div className="studio-compare-stats">
          <span className="studio-compare-added"><Plus size={13} aria-hidden="true" />{diff.insertedWords} {diff.coarse ? "words in added blocks" : "words added"}{previewTruncated ? " (preview)" : ""}</span>
          <span className="studio-compare-removed"><Minus size={13} aria-hidden="true" />{diff.deletedWords} {diff.coarse ? "words in removed blocks" : "words removed"}{previewTruncated ? " (preview)" : ""}</span>
        </div>
        <div className="studio-compare-switch" role="group" aria-label="Comparison layout">
          <button type="button" aria-pressed={layout === "inline"} onClick={() => setLayout("inline")}>Inline</button>
          <button type="button" aria-pressed={layout === "split"} onClick={() => setLayout("split")}>Side by side</button>
        </div>
      </div>
      {!changed && <div className="studio-compare-notice"><CheckCircle size={16} aria-hidden="true" />{text ? `${resultLabel} matches the ${originalLabel.toLocaleLowerCase()}. Edits will appear here.` : "Add a draft to start comparing."}</div>}
      {previewTruncated && <p className="studio-compare-notice"><Info size={16} aria-hidden="true" />Comparison shows the first {MAX_COMPARISON_PREVIEW_CHARACTERS.toLocaleString()} characters of each version. Your full source is preserved; changes beyond this preview are not shown.</p>}
      {diff.coarse && <p className="studio-compare-notice"><Info size={16} aria-hidden="true" />Large changes are shown as complete blocks to keep comparison responsive.</p>}
      {layout === "split" ? (
        <div className="studio-compare-columns">
          <div className="studio-compare-pane"><div className="studio-compare-pane-heading"><span>{originalLabel}</span><span>{countWords(previewOriginal).toLocaleString()} words{previewTruncated ? " in preview" : ""}</span></div><div className="studio-compare-document" aria-label={`${originalLabel} text`}><DiffText chunks={diff.chunks} side="original" />{!originalText && <span className="studio-compare-empty">The {originalLabel.toLocaleLowerCase()} is empty.</span>}</div></div>
          <div className="studio-compare-pane"><div className="studio-compare-pane-heading"><span>{resultLabel}</span><span>{countWords(previewText).toLocaleString()} words{previewTruncated ? " in preview" : ""}</span></div><div className="studio-compare-document" aria-label={resultLabel === "Your draft" ? "Edited text" : `${resultLabel} text`}><DiffText chunks={diff.chunks} side="edited" />{!text && <span className="studio-compare-empty">{resultLabel} is empty.</span>}</div></div>
        </div>
      ) : <div className="studio-compare-document" aria-label="Inline text comparison"><DiffText chunks={diff.chunks} side="inline" /></div>}
      <div className="studio-compare-legend"><span><i className="is-added" />Added</span><span><i className="is-removed" />Removed</span><span>Original always preserved</span></div>
    </section>
  );
}
