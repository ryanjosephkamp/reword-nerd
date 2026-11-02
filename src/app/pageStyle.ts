// How the page looks: paper, typeface, and size. One choice for every document, remembered in
// this browser, and used for exports too.
import { useSyncExternalStore } from "react";
import type { PageFont, PageLook, PageSize, PaperStyle } from "../engine/page/look";

export type PageStyle = Omit<PageLook, "link">;

export const PAPERS: { value: PaperStyle; label: string }[] = [
  { value: "paper", label: "Paper" },
  { value: "white", label: "White" },
  { value: "sepia", label: "Sepia" },
  { value: "night", label: "Night" },
];

export const FONTS: { value: PageFont; label: string }[] = [
  { value: "serif", label: "Serif" },
  { value: "sans", label: "Sans" },
];

export const SIZES: { value: PageSize; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];

const KEY = "reword-nerd:page";
const DEFAULT: PageStyle = { paper: "paper", font: "serif", size: "medium" };

function read(): PageStyle {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return {
      paper: PAPERS.some((option) => option.value === stored.paper) ? stored.paper : DEFAULT.paper,
      font: FONTS.some((option) => option.value === stored.font) ? stored.font : DEFAULT.font,
      size: SIZES.some((option) => option.value === stored.size) ? stored.size : DEFAULT.size,
    };
  } catch {
    return DEFAULT;
  }
}

let current = read();
const listeners = new Set<() => void>();

export function setPageStyle(change: Partial<PageStyle>): void {
  current = { ...current, ...change };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // The choice still applies for this visit.
  }
  for (const listener of listeners) listener();
}

export function getPageStyle(): PageStyle {
  return current;
}

export function usePageStyle(): PageStyle {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}

/** The attributes that apply a page style to a `.page` element. */
export function pageAttributes(style: PageStyle) {
  return { "data-style": style.paper, "data-font": style.font, "data-size": style.size };
}
