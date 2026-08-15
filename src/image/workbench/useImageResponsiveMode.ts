import { useEffect, useState } from "react";
import type { ImageResponsiveMode } from "./contracts";

const MOBILE_QUERY = "(max-width: 767px)";
const TABLET_QUERY = "(min-width: 768px) and (max-width: 1279px)";

export function readImageResponsiveMode(): ImageResponsiveMode {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "desktop";
  if (window.matchMedia(MOBILE_QUERY).matches) return "mobile";
  if (window.matchMedia(TABLET_QUERY).matches) return "tablet";
  return "desktop";
}

export function useImageResponsiveMode(
  onModeChange?: (nextMode: ImageResponsiveMode) => void,
): ImageResponsiveMode {
  const [mode, setMode] = useState(readImageResponsiveMode);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mobile = window.matchMedia(MOBILE_QUERY);
    const tablet = window.matchMedia(TABLET_QUERY);
    let currentMode = readImageResponsiveMode();
    const update = () => {
      const nextMode = readImageResponsiveMode();
      if (nextMode === currentMode) return;
      currentMode = nextMode;
      onModeChange?.(nextMode);
      setMode(nextMode);
    };
    mobile.addEventListener("change", update);
    tablet.addEventListener("change", update);
    update();
    return () => {
      mobile.removeEventListener("change", update);
      tablet.removeEventListener("change", update);
    };
  }, [onModeChange]);
  return mode;
}
