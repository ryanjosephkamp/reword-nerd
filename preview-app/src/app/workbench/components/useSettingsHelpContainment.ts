import { useEffect } from "react";

export function useSettingsHelpContainment(
  rootRef: React.RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      const insideOwnHelpSurface = Boolean(
        rootRef.current?.contains(event.target)
        && event.target.closest(".settings-help-trigger, .settings-help-popover"),
      );
      if (!insideOwnHelpSurface) onClose();
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [onClose, rootRef]);
}
