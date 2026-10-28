// The page styles a document can be read, edited, and exported in. The colors here match
// src/styles/page.css (a test checks), so a Word file looks like the page it came from.

export type PaperStyle = "paper" | "white" | "sepia" | "night";
export type PageFont = "serif" | "sans";
export type PageSize = "small" | "medium" | "large";

export interface PageLook {
  paper: PaperStyle;
  font: PageFont;
  size: PageSize;
  /** Link color as #rrggbb, from the current color palette. */
  link?: string;
}

export interface PaperColors {
  bg: string;
  ink: string;
  muted: string;
  line: string;
}

export const PAPER_COLORS: Record<PaperStyle, PaperColors> = {
  paper: { bg: "#f6f4ec", ink: "#26333c", muted: "#5f6c74", line: "#dcd9cb" },
  white: { bg: "#ffffff", ink: "#1d252b", muted: "#59646c", line: "#e1e5e8" },
  sepia: { bg: "#f1e7d3", ink: "#44362a", muted: "#6d5b49", line: "#d9c9ad" },
  night: { bg: "#1b252c", ink: "#e3e9ec", muted: "#a3b1b9", line: "#33424c" },
};

/** Fonts that Word has on nearly every computer, closest to the page's own. */
export const WORD_FONTS: Record<PageFont, string> = { serif: "Georgia", sans: "Arial" };

/** Body text size in points. */
export const POINT_SIZES: Record<PageSize, number> = { small: 11, medium: 12, large: 14 };
