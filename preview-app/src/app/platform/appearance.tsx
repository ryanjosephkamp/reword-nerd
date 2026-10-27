/* eslint-disable react-refresh/only-export-components -- This public module pairs the shared appearance hook with its controls. */
import { useCallback, useEffect, useState } from "react";
import { Moon, Sun } from "@phosphor-icons/react";
import "./appearance.css";

export const PALETTES = [
  { value: "graphite", label: "Graphite" },
  { value: "lime", label: "Lime" },
  { value: "amber", label: "Amber" },
  { value: "original", label: "Original green" },
] as const;

export type AppearancePalette = (typeof PALETTES)[number]["value"];
export type AppearanceMode = "dark" | "light";
export interface AppearancePreference {
  palette: AppearancePalette;
  mode: AppearanceMode;
}
export interface AppearanceControlsProps extends AppearancePreference {
  setPalette: (palette: AppearancePalette) => void;
  setMode: (mode: AppearanceMode) => void;
}

export const APPEARANCE_STORAGE_KEY = "reword-nerd:appearance:v1";
export const DEFAULT_APPEARANCE: Readonly<AppearancePreference> = {
  palette: "graphite",
  mode: "dark",
};

function isPalette(value: unknown): value is AppearancePalette {
  return PALETTES.some((palette) => palette.value === value);
}

function isMode(value: unknown): value is AppearanceMode {
  return value === "dark" || value === "light";
}

function readAppearance(): AppearancePreference {
  if (typeof window === "undefined") return { ...DEFAULT_APPEARANCE };
  try {
    const stored = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (!stored || stored.length > 1024) return { ...DEFAULT_APPEARANCE };
    const value: unknown = JSON.parse(stored);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { ...DEFAULT_APPEARANCE };
    }
    const preference = value as Record<string, unknown>;
    if (
      preference.version !== 1 ||
      !isPalette(preference.palette) ||
      !isMode(preference.mode)
    ) {
      return { ...DEFAULT_APPEARANCE };
    }
    return { palette: preference.palette, mode: preference.mode };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

/** Persist appearance only; documents, prompts, and job state never enter this key. */
export function useAppearance(): AppearanceControlsProps {
  const [preference, setPreference] =
    useState<AppearancePreference>(readAppearance);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        APPEARANCE_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          palette: preference.palette,
          mode: preference.mode,
        }),
      );
    } catch {
      // A disabled or full storage area must not prevent an in-memory theme change.
    }
  }, [preference.palette, preference.mode]);

  const setPalette = useCallback((palette: AppearancePalette) => {
    if (isPalette(palette))
      setPreference((current) => ({ ...current, palette }));
  }, []);
  const setMode = useCallback((mode: AppearanceMode) => {
    if (isMode(mode)) setPreference((current) => ({ ...current, mode }));
  }, []);

  return { ...preference, setPalette, setMode };
}

export function AppearanceControls({
  palette,
  setPalette,
  mode,
  setMode,
}: AppearanceControlsProps) {
  const nextMode = mode === "dark" ? "light" : "dark";
  const ModeIcon = mode === "dark" ? Moon : Sun;

  return (
    <div className="appearance-controls" role="group" aria-label="Appearance">
      <label className="appearance-palette">
        <span className="appearance-swatch" aria-hidden="true" />
        <span className="appearance-sr-only">Color palette</span>
        <select
          aria-label="Color palette"
          value={palette}
          onChange={(event) =>
            setPalette(event.target.value as AppearancePalette)
          }
        >
          {PALETTES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="appearance-mode"
        aria-label={`Switch to ${nextMode} appearance`}
        title={`Switch to ${nextMode} appearance`}
        onClick={() => setMode(nextMode)}
      >
        <ModeIcon size={15} aria-hidden="true" />
        <span>{mode === "dark" ? "Dark" : "Light"}</span>
      </button>
    </div>
  );
}
