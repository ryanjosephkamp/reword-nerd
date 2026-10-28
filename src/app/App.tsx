import { lazy, Suspense } from "react";
import { Header } from "./shell/Header";
import { Notices } from "./shell/Notices";
import { useWorkspace } from "./store";
import { useAutosave, useSaveState } from "./useAutosave";

const TextMode = lazy(() => import("./text/TextMode"));
const ImagesMode = lazy(() => import("./images/ImagesMode"));

export function App() {
  useAutosave();
  const mode = useWorkspace((state) => state.mode);
  const loaded = useSaveState((state) => state.loaded);
  const busy = useWorkspace((state) => state.busy);

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to the workspace
      </a>
      <Header />
      <main id="main" className="app-main" aria-busy={!loaded || busy !== null}>
        {loaded && (
          <Suspense fallback={<p className="loading">Loading…</p>}>
            {mode === "text" ? <TextMode /> : <ImagesMode />}
          </Suspense>
        )}
      </main>
      {busy && (
        <div className="busy" role="status">
          {busy}
        </div>
      )}
      <Notices />
    </div>
  );
}
