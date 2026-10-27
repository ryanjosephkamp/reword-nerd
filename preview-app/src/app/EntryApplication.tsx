import { lazy, Suspense } from "react";
import { entryRoute } from "./entryRoute";

// Load the introduction independently, leaving the document engine for the studio.
const Application = lazy(() =>
  entryRoute(window.location.search) === "welcome"
    ? import("./studio/StudioWelcome").then((module) => ({
        default: module.StudioWelcome,
      }))
    : import("./App").then((module) => ({ default: module.App })),
);

export function EntryApplication() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: "40px", color: "#c1ed9b" }}>
          Loading workspace…
        </div>
      }
    >
      <Application />
    </Suspense>
  );
}
