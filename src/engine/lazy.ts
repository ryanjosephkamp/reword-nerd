// Loads something once and reuses it, but forgets a failed load so the next call tries again:
// a dropped connection while fetching a library chunk shouldn't break that feature until reload.
export function loadOnce<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    if (!pending) {
      const attempt = load();
      pending = attempt;
      attempt.catch(() => {
        if (pending === attempt) pending = undefined;
      });
    }
    return pending;
  };
}
