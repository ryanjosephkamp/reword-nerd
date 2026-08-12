import "@testing-library/jest-dom/vitest";

if (typeof window.localStorage?.getItem !== "function") {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      get length() { return values.size; },
      clear() { values.clear(); },
      getItem(key: string) { return values.get(String(key)) ?? null; },
      key(index: number) { return [...values.keys()][index] ?? null; },
      removeItem(key: string) { values.delete(String(key)); },
      setItem(key: string, value: string) { values.set(String(key), String(value)); },
    },
  });
}
