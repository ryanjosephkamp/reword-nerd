import { useEffect } from "react";

// Object URLs are shared per Blob and revoked shortly after the last user lets go. The delay
// covers React's development double-mount and quick re-renders that hand the same Blob back.
const REVOKE_DELAY_MS = 1000;

interface Entry {
  url: string;
  users: number;
  timer?: ReturnType<typeof setTimeout>;
}

const entries = new Map<Blob, Entry>();

function scheduleRevoke(blob: Blob, entry: Entry) {
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    if (entry.users > 0) return;
    URL.revokeObjectURL(entry.url);
    entries.delete(blob);
  }, REVOKE_DELAY_MS);
}

function urlFor(blob: Blob): string {
  let entry = entries.get(blob);
  if (!entry) {
    entry = { url: URL.createObjectURL(blob), users: 0 };
    entries.set(blob, entry);
    // A render that never commits still gets its URL cleaned up.
    scheduleRevoke(blob, entry);
  }
  return entry.url;
}

/** An object URL for a Blob that stays valid while the component shows it. */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const url = blob ? urlFor(blob) : null;
  useEffect(() => {
    if (!blob) return;
    const entry = entries.get(blob);
    if (!entry) return;
    entry.users += 1;
    clearTimeout(entry.timer);
    return () => {
      entry.users -= 1;
      if (entry.users <= 0) scheduleRevoke(blob, entry);
    };
  }, [blob, url]);
  return url;
}
