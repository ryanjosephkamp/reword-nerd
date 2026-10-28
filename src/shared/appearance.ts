// Light, dark, or the device's setting, plus a color palette. Shared by every page: the landing
// page, the app, and the Updates pages all read the same two keys and show the same menu.
import { PALETTES, type PaletteId } from "./palettes";

export { PALETTES, type PaletteId };
export type ThemeChoice = "system" | "light" | "dark";

export interface Appearance {
  theme: ThemeChoice;
  palette: PaletteId;
}

const THEME_KEY = "reword-nerd:theme";
const PALETTE_KEY = "reword-nerd:palette";
const CHANGE = "reword-nerd:appearance";

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "Device" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function isPalette(value: string | null): value is PaletteId {
  return PALETTES.some((palette) => palette.id === value);
}

export function readAppearance(): Appearance {
  try {
    const theme = localStorage.getItem(THEME_KEY);
    const palette = localStorage.getItem(PALETTE_KEY);
    return {
      theme: theme === "light" || theme === "dark" ? theme : "system",
      palette: isPalette(palette) ? palette : "harbor",
    };
  } catch {
    return { theme: "system", palette: "harbor" };
  }
}

function applyToDocument({ theme, palette }: Appearance): void {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.dataset.theme = theme;
  if (palette === "harbor") root.removeAttribute("data-palette");
  else root.dataset.palette = palette;
}

/** Applies a change, remembers it in this browser, and tells every open menu. */
export function setAppearance(change: Partial<Appearance>): Appearance {
  const next = { ...readAppearance(), ...change };
  applyToDocument(next);
  try {
    if (next.theme === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, next.theme);
    if (next.palette === "harbor") localStorage.removeItem(PALETTE_KEY);
    else localStorage.setItem(PALETTE_KEY, next.palette);
  } catch {
    // The choice still applies for this visit.
  }
  window.dispatchEvent(new CustomEvent(CHANGE));
  return next;
}

export function effectiveTheme(theme: ThemeChoice): "light" | "dark" {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** Calls back whenever the appearance changes here, in another tab, or on the device. */
export function onAppearanceChange(callback: (appearance: Appearance) => void): () => void {
  const notify = () => callback(readAppearance());
  const fromOtherTab = (event: StorageEvent) => {
    if (event.key === THEME_KEY || event.key === PALETTE_KEY || event.key === null) {
      applyToDocument(readAppearance());
      notify();
    }
  };
  const media = window.matchMedia("(prefers-color-scheme: light)");
  window.addEventListener(CHANGE, notify);
  window.addEventListener("storage", fromOtherTab);
  media.addEventListener("change", notify);
  return () => {
    window.removeEventListener(CHANGE, notify);
    window.removeEventListener("storage", fromOtherTab);
    media.removeEventListener("change", notify);
  };
}

let menuCount = 0;

/** Builds the mode and palette choices inside `container`. Returns a cleanup function. */
export function mountAppearanceControls(container: HTMLElement): () => void {
  const id = `appearance-${(menuCount += 1)}`;
  container.classList.add("appearance");
  container.innerHTML = `
    <fieldset class="appearance-group">
      <legend>Mode</legend>
      <div class="appearance-modes">
        ${THEMES.map(
          ({ value, label }) => `
          <label class="appearance-mode">
            <input type="radio" name="${id}-theme" value="${value}">
            <span>${label}</span>
          </label>`,
        ).join("")}
      </div>
    </fieldset>
    <fieldset class="appearance-group">
      <legend>Color</legend>
      <div class="appearance-palettes">
        ${PALETTES.map(
          (palette) => `
          <label class="appearance-palette" style="--swatch-dark-bg:${palette.dark.bg};--swatch-dark:${palette.dark.accent};--swatch-light-bg:${palette.light.bg};--swatch-light:${palette.light.accent}">
            <input type="radio" name="${id}-palette" value="${palette.id}">
            <span class="appearance-swatch" aria-hidden="true"></span>
            <span>${palette.label}</span>
          </label>`,
        ).join("")}
      </div>
    </fieldset>`;

  const sync = ({ theme, palette }: Appearance) => {
    for (const input of container.querySelectorAll<HTMLInputElement>("input")) {
      input.checked = input.name.endsWith("-theme")
        ? input.value === theme
        : input.value === palette;
    }
  };
  const change = (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (input.name.endsWith("-theme")) setAppearance({ theme: input.value as ThemeChoice });
    else setAppearance({ palette: input.value as PaletteId });
  };
  sync(readAppearance());
  container.addEventListener("change", change);
  const stop = onAppearanceChange(sync);
  return () => {
    stop();
    container.removeEventListener("change", change);
    container.innerHTML = "";
  };
}

const supportsPopover = typeof HTMLElement !== "undefined" && "popover" in HTMLElement.prototype;

/** Turns `button` into the opener of a small appearance menu. Returns a cleanup function. */
export function mountAppearanceMenu(button: HTMLButtonElement): () => void {
  const menu = document.createElement("div");
  menu.id = `appearance-menu-${(menuCount += 1)}`;
  menu.className = "appearance-menu";
  menu.setAttribute("role", "dialog");
  menu.setAttribute("aria-label", "Appearance");
  const stopControls = mountAppearanceControls(menu);
  document.body.append(menu);

  // Computed from the button alone, so it can be placed before it shows.
  const place = () => {
    const rect = button.getBoundingClientRect();
    const width = Math.min(18 * 16, window.innerWidth - 16);
    menu.style.width = `${width}px`;
    menu.style.top = `${Math.round(rect.bottom + 8)}px`;
    menu.style.left = `${Math.round(Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)))}px`;
  };
  const focusChoice = () =>
    menu.querySelector<HTMLInputElement>("input:checked")?.focus({ preventScroll: true });

  let cleanupOpen = () => {};
  if (supportsPopover) {
    menu.popover = "auto";
    button.setAttribute("popovertarget", menu.id);
    const opening = (event: Event) => {
      if ((event as ToggleEvent).newState === "open") place();
    };
    const toggled = (event: Event) => {
      const open = (event as ToggleEvent).newState === "open";
      if (open) {
        focusChoice();
      } else if (
        menu.contains(document.activeElement) ||
        document.activeElement === document.body
      ) {
        button.focus({ preventScroll: true });
      }
    };
    menu.addEventListener("beforetoggle", opening);
    menu.addEventListener("toggle", toggled);
    cleanupOpen = () => {
      menu.removeEventListener("beforetoggle", opening);
      menu.removeEventListener("toggle", toggled);
    };
  } else {
    // Older browsers: open and close by hand, with Escape and outside clicks closing it.
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", menu.id);
    const close = (refocus: boolean) => {
      menu.hidden = true;
      button.setAttribute("aria-expanded", "false");
      if (refocus) button.focus();
    };
    const click = () => {
      if (menu.hidden) {
        menu.hidden = false;
        button.setAttribute("aria-expanded", "true");
        place();
        focusChoice();
      } else close(false);
    };
    const outside = (event: PointerEvent) => {
      if (!menu.hidden && !menu.contains(event.target as Node) && event.target !== button)
        close(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !menu.hidden) close(true);
    };
    button.addEventListener("click", click);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    cleanupOpen = () => {
      button.removeEventListener("click", click);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }
  window.addEventListener("resize", place);

  return () => {
    cleanupOpen();
    window.removeEventListener("resize", place);
    button.removeAttribute("popovertarget");
    stopControls();
    menu.remove();
  };
}
