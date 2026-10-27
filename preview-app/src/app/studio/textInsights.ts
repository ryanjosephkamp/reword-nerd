export type InsightObservation = {
  title: string;
  description: string;
  tone: "good" | "consider" | "neutral";
};

export type TextInsightResult = {
  wordCount: number;
  characterCount: number;
  sentenceCount: number;
  paragraphCount: number;
  averageSentenceWords: number;
  readingSeconds: number;
  readingEase: number | null;
  readabilityLabel: string;
  sentenceLengths: number[];
  distribution: { short: number; medium: number; long: number };
  observations: InsightObservation[];
  sampled: boolean;
  analyzedCharacters: number;
};

export const MAX_ANALYSIS_CHARACTERS = 200_000;
export const MAX_COMPARISON_PREVIEW_CHARACTERS = 50_000;
const MAX_DIFF_CHARACTERS = 200_000;
const MAX_DIFF_CELLS = 500_000;
const WORD_PATTERN = /[\p{L}\p{M}\p{N}]+(?:['’-][\p{L}\p{M}\p{N}]+)*/gu;
const TOKEN_PATTERN = /\s+|[\p{L}\p{M}\p{N}]+(?:['’-][\p{L}\p{M}\p{N}]+)*|[^\s]/gu;
const COMMON_WORDS = new Set([
  "about", "after", "again", "also", "another", "because", "been", "before", "being",
  "between", "both", "could", "does", "each", "even", "from", "have", "into", "just",
  "like", "more", "most", "much", "must", "only", "other", "over", "same", "should",
  "some", "such", "than", "that", "their", "them", "then", "there", "these", "they",
  "this", "those", "through", "under", "very", "were", "what", "when", "where", "which",
  "while", "will", "with", "would", "your", "you’re", "you're",
]);

export function countWords(text: string): number {
  let count = 0;
  const matches = text.matchAll(WORD_PATTERN);
  while (!matches.next().done) count++;
  return count;
}

function estimateSyllables(word: string): number {
  const normalized = word.toLowerCase().replace(/[^a-z]/g, "");
  if (normalized.length < 4) return 1;
  const endingAdjusted = normalized.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "");
  return Math.max(1, (endingAdjusted.match(/[aeiouy]+/g) ?? []).length);
}

function splitSentences(text: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
    return Array.from(segmenter.segment(text), ({ segment }) => segment).filter((sentence) => countWords(sentence) > 0);
  }
  return (text.match(/[^.!?。！？]+(?:[.!?。！？]+|$)/gu) ?? []).filter((sentence) => countWords(sentence) > 0);
}

/** Counts and observations describe the analyzed text; readability is an English heuristic. */
export function analyzeText(text: string): TextInsightResult {
  const sampled = text.length > MAX_ANALYSIS_CHARACTERS;
  const analyzedText = sampled ? text.slice(0, MAX_ANALYSIS_CHARACTERS) : text;
  const words = Array.from(analyzedText.matchAll(WORD_PATTERN), (match) => match[0]);
  const wordCount = words.length;
  const sentences = splitSentences(analyzedText);
  const sentenceLengths = sentences.map(countWords);
  const sentenceCount = sentenceLengths.length;
  const paragraphCount = analyzedText.split(/\n\s*\n/).filter((paragraph) => countWords(paragraph) > 0).length;
  const averageSentenceWords = sentenceCount ? wordCount / sentenceCount : 0;
  const distribution = { short: 0, medium: 0, long: 0 };
  for (const length of sentenceLengths) {
    if (length <= 12) distribution.short++;
    else if (length <= 25) distribution.medium++;
    else distribution.long++;
  }

  const englishLikeWords = words.filter((word) => /^[a-z]+(?:['’-][a-z]+)*$/i.test(word));
  const canEstimate = wordCount >= 30 && englishLikeWords.length / wordCount >= 0.8 && sentenceCount > 0;
  const syllables = words.reduce((sum, word) => sum + estimateSyllables(word), 0);
  const readingEase = canEstimate
    ? Math.round(Math.max(0, Math.min(100, 206.835 - 1.015 * averageSentenceWords - 84.6 * syllables / wordCount)))
    : null;
  const readabilityLabel = readingEase === null ? "More text needed" : readingEase >= 70 ? "Easy to follow" : readingEase >= 50 ? "A little more depth" : "Needs a close read";
  const observations: InsightObservation[] = [];

  if (wordCount === 0) {
    observations.push({ title: "Start with your words", description: "Add a draft to see its pace, reading time, and sentence patterns.", tone: "neutral" });
  } else if (wordCount < 30) {
    observations.push({ title: "A small sample", description: "Add at least 30 words for a useful readability estimate. Your word and sentence counts are ready.", tone: "neutral" });
  } else if (!canEstimate) {
    observations.push({ title: "Keep the language in mind", description: "The readability formula is designed for English, so no score is shown for this sample.", tone: "neutral" });
  }

  if (distribution.long > 0) {
    const longestSentence = sentenceLengths.reduce((longest, length) => Math.max(longest, length), 0);
    observations.push({
      title: distribution.long === 1 ? "One sentence to revisit" : `${distribution.long} sentences to revisit`,
      description: `Your longest sentence has ${longestSentence} words. Try splitting one idea into its own sentence, if the meaning stays intact.`,
      tone: "consider",
    });
  }

  if (wordCount > 180 && paragraphCount < 2) {
    observations.push({ title: "Give your reader a breather", description: `All ${wordCount.toLocaleString()} words sit in one paragraph. A break at a change of topic could help readers navigate.`, tone: "consider" });
  }

  const frequency = new Map<string, number>();
  for (const word of words) {
    const key = word.toLocaleLowerCase();
    if (key.length > 3 && !COMMON_WORDS.has(key)) frequency.set(key, (frequency.get(key) ?? 0) + 1);
  }
  let repeatedWord = "";
  let repeatedCount = 0;
  for (const [word, count] of frequency) {
    if (count > repeatedCount) {
      repeatedWord = word;
      repeatedCount = count;
    }
  }
  if (repeatedCount >= 4 && repeatedCount / wordCount >= 0.03) {
    observations.push({ title: "A word worth checking", description: `“${repeatedWord}” appears ${repeatedCount} times. Keep it if consistency matters; vary it only if the repetition distracts.`, tone: "consider" });
  }

  if (observations.length === 0 || (observations.length === 1 && wordCount >= 30)) {
    if (distribution.long === 0 && sentenceCount >= 2) {
      observations.push({ title: "Room to keep the rhythm", description: `All ${sentenceCount} sentences are 25 words or fewer. Read the draft aloud to check the flow between them.`, tone: "good" });
    } else if (paragraphCount >= 2 && observations.length < 3) {
      observations.push({ title: "A little breathing room", description: `${paragraphCount} paragraphs give your draft natural pauses. Check that each one carries a clear idea.`, tone: "good" });
    }
  }

  return {
    wordCount,
    characterCount: analyzedText.length,
    sentenceCount,
    paragraphCount,
    averageSentenceWords,
    readingSeconds: Math.ceil(wordCount / 200 * 60),
    readingEase,
    readabilityLabel: canEstimate || wordCount < 30 ? readabilityLabel : "English estimate unavailable",
    sentenceLengths,
    distribution,
    observations: observations.slice(0, 3),
    sampled,
    analyzedCharacters: analyzedText.length,
  };
}

export type DiffChunk = { kind: "equal" | "insert" | "delete"; text: string };
export type WordDiffResult = {
  chunks: DiffChunk[];
  insertedWords: number;
  deletedWords: number;
  coarse: boolean;
};

function finishDiff(chunks: DiffChunk[], coarse: boolean): WordDiffResult {
  const nonempty = chunks.filter((chunk) => chunk.text.length > 0);
  return {
    chunks: nonempty,
    insertedWords: nonempty.reduce((sum, chunk) => sum + (chunk.kind === "insert" ? countWords(chunk.text) : 0), 0),
    deletedWords: nonempty.reduce((sum, chunk) => sum + (chunk.kind === "delete" ? countWords(chunk.text) : 0), 0),
    coarse,
  };
}

/** Exact text reconstruction with bounded LCS work; broad changes fall back to whole blocks. */
export function createWordDiff(originalText: string, text: string): WordDiffResult {
  if (originalText === text) return finishDiff([{ kind: "equal", text }], false);
  if (!originalText) return finishDiff([{ kind: "insert", text }], false);
  if (!text) return finishDiff([{ kind: "delete", text: originalText }], false);
  if (originalText.length + text.length > MAX_DIFF_CHARACTERS) {
    return finishDiff([{ kind: "delete", text: originalText }, { kind: "insert", text }], true);
  }

  const before = originalText.match(TOKEN_PATTERN) ?? [];
  const after = text.match(TOKEN_PATTERN) ?? [];
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;

  const oldMiddle = before.slice(prefix, before.length - suffix);
  const newMiddle = after.slice(prefix, after.length - suffix);
  const chunks: DiffChunk[] = [{ kind: "equal", text: before.slice(0, prefix).join("") }];
  const cells = (oldMiddle.length + 1) * (newMiddle.length + 1);
  if (cells > MAX_DIFF_CELLS) {
    chunks.push({ kind: "delete", text: oldMiddle.join("") }, { kind: "insert", text: newMiddle.join("") });
  } else {
    const width = newMiddle.length + 1;
    const lengths = new Uint32Array(cells);
    for (let oldIndex = oldMiddle.length - 1; oldIndex >= 0; oldIndex--) {
      for (let newIndex = newMiddle.length - 1; newIndex >= 0; newIndex--) {
        lengths[oldIndex * width + newIndex] = oldMiddle[oldIndex] === newMiddle[newIndex]
          ? lengths[(oldIndex + 1) * width + newIndex + 1] + 1
          : Math.max(lengths[(oldIndex + 1) * width + newIndex], lengths[oldIndex * width + newIndex + 1]);
      }
    }
    let oldIndex = 0;
    let newIndex = 0;
    const groups: { kind: DiffChunk["kind"]; tokens: string[] }[] = [];
    const add = (kind: DiffChunk["kind"], token: string) => {
      const last = groups[groups.length - 1];
      if (last?.kind === kind) last.tokens.push(token);
      else groups.push({ kind, tokens: [token] });
    };
    while (oldIndex < oldMiddle.length || newIndex < newMiddle.length) {
      if (oldIndex < oldMiddle.length && newIndex < newMiddle.length && oldMiddle[oldIndex] === newMiddle[newIndex]) {
        add("equal", oldMiddle[oldIndex++]);
        newIndex++;
      } else if (oldIndex < oldMiddle.length && (newIndex >= newMiddle.length || lengths[(oldIndex + 1) * width + newIndex] >= lengths[oldIndex * width + newIndex + 1])) {
        add("delete", oldMiddle[oldIndex++]);
      } else {
        add("insert", newMiddle[newIndex++]);
      }
    }
    chunks.push(...groups.map(({ kind, tokens }) => ({ kind, text: tokens.join("") })));
  }
  if (suffix > 0) chunks.push({ kind: "equal", text: before.slice(before.length - suffix).join("") });
  return finishDiff(chunks, cells > MAX_DIFF_CELLS);
}

export function formatReadingTime(seconds: number): string {
  if (seconds === 0) return "—";
  if (seconds < 60) return "< 1 min";
  return `${Math.ceil(seconds / 60)} min`;
}
