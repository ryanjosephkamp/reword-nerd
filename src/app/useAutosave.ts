// Keeps the saved copy in step with the workspace while "Save on this device" is on.
import { useEffect, useRef } from "react";
import { create } from "zustand";
import {
  describeSaveError,
  forgetOnDevice,
  loadFromDevice,
  rememberEnabled,
  saveOnDevice,
  setRememberEnabled,
} from "./persist";
import { hasWork, useWorkspace, workspaceData } from "./store";

const SAVE_DELAY_MS = 800;
const CHANNEL = "reword-nerd:workspace";

interface SaveState {
  remember: boolean;
  loaded: boolean;
  saving: boolean;
  savedAt: number | null;
  error: string | null;
  /** Another tab saved after this one loaded. */
  changedElsewhere: boolean;
}

export const useSaveState = create<SaveState>()(() => ({
  remember: rememberEnabled(),
  loaded: false,
  saving: false,
  savedAt: null,
  error: null,
  changedElsewhere: false,
}));

const tabId = Math.random().toString(36).slice(2);

function channel(): BroadcastChannel | null {
  return typeof BroadcastChannel === "function" ? new BroadcastChannel(CHANNEL) : null;
}

export async function setRemember(on: boolean): Promise<void> {
  setRememberEnabled(on);
  useSaveState.setState({ remember: on, error: null });
  if (on) await saveNow();
  else {
    await forgetOnDevice().catch(() => undefined);
    useSaveState.setState({ savedAt: null });
  }
}

export async function saveNow(): Promise<void> {
  if (!useSaveState.getState().remember) return;
  useSaveState.setState({ saving: true });
  try {
    const savedAt = await saveOnDevice(workspaceData(useWorkspace.getState()));
    useSaveState.setState({ saving: false, savedAt, error: null });
    channel()?.postMessage({ tabId, savedAt });
  } catch (error) {
    useSaveState.setState({ saving: false, error: describeSaveError(error) });
  }
}

/** Loads the saved workspace once, then saves after changes and warns before losing unsaved work. */
export function useAutosave(): void {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (rememberEnabled()) {
        try {
          const saved = await loadFromDevice();
          if (saved && !cancelled) {
            useWorkspace.getState().replace(saved.data);
            // A link like ?mode=images wins over the mode the workspace was saved in.
            const requested = new URLSearchParams(window.location.search).get("mode");
            if (requested === "text" || requested === "images") {
              useWorkspace.getState().setMode(requested);
            }
            useSaveState.setState({ savedAt: saved.savedAt });
          }
        } catch (error) {
          useSaveState.setState({ error: describeSaveError(error) });
        }
      }
      if (!cancelled) useSaveState.setState({ loaded: true });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Only data changes trigger a save; notices and progress labels don't.
    const unsubscribe = useWorkspace.subscribe((state, previous) => {
      if (!useSaveState.getState().loaded || !useSaveState.getState().remember) return;
      const now = workspaceData(state);
      const before = workspaceData(previous);
      const changed = (Object.keys(now) as (keyof typeof now)[]).some(
        (key) => now[key] !== before[key],
      );
      if (!changed) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void saveNow(), SAVE_DELAY_MS);
    });
    return () => {
      unsubscribe();
      clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    const listener = channel();
    if (!listener) return;
    listener.onmessage = (event: MessageEvent<{ tabId: string }>) => {
      if (event.data.tabId !== tabId) useSaveState.setState({ changedElsewhere: true });
    };
    return () => listener.close();
  }, []);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      const save = useSaveState.getState();
      const unsaved = !save.remember || save.saving || save.error !== null;
      if (unsaved && hasWork(useWorkspace.getState())) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
}
