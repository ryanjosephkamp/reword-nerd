export type EntryRoute = "studio" | "welcome" | "classic";

/** Explicit classic links and classic-only builds preserve the original entry. */
export function entryRoute(search: string): EntryRoute {
  const params = new URLSearchParams(search);
  if (
    import.meta.env.VITE_STUDIO_DEFAULT === "0" ||
    params.get("workbench") === "classic"
  )
    return "classic";
  return params.get("view") === "welcome" ? "welcome" : "studio";
}
