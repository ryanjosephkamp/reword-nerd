import {
  CaretDown,
  CaretRight,
  FileText,
  FolderSimple,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import { useState } from "react";
import type { TextProject, TextSource } from "../../engine/types";
import { baseName } from "../batch";
import { useWorkspace } from "../store";
import { AddButtons } from "./AddButtons";

const EXCLUSION_LABELS: Record<TextProject["excluded"][number]["reason"], string> = {
  "dependency-or-build-output": "dependency or build output",
  "lock-file": "lock file",
  binary: "not a text file",
  "too-large": "too large",
  credentials: "may contain passwords or keys",
  "ignored-by-gitignore": "listed in .gitignore",
  "unreadable-text": "couldn't be read as text",
  "link-or-locked": "a link or a password-protected file",
  "nested-archive": "archive inside the project",
};

function FileRow({ source, nested }: { source: TextSource; nested?: boolean }) {
  const selected = useWorkspace((state) => state.selectedSourceId === source.id);
  const select = useWorkspace((state) => state.selectSource);
  const update = useWorkspace((state) => state.updateSource);
  const remove = useWorkspace((state) => state.removeSource);
  const name = nested ? source.path : baseName(source.path);
  return (
    <li className={`file-row ${selected ? "file-row-selected" : ""}`}>
      <input
        type="checkbox"
        checked={source.included}
        onChange={(event) => update(source.id, { included: event.target.checked })}
        aria-label={`Include ${name} in the rewrite`}
      />
      <button
        type="button"
        className="file-row-name"
        onClick={() => select(source.id)}
        title={source.path}
      >
        {!nested && <FileText aria-hidden />}
        <span>{name}</span>
        {source.notes.length > 0 && (
          <WarningCircle aria-label="Has notes" className="file-row-note" />
        )}
      </button>
      {!nested && (
        <button
          type="button"
          className="btn-icon btn-icon-quiet"
          aria-label={`Remove ${name}`}
          onClick={() => remove(source.id)}
        >
          <Trash aria-hidden />
        </button>
      )}
    </li>
  );
}

function ProjectGroup({ project, files }: { project: TextProject; files: TextSource[] }) {
  const [open, setOpen] = useState(true);
  const [showSkipped, setShowSkipped] = useState(false);
  const setIncluded = useWorkspace((state) => state.setProjectIncluded);
  const removeProject = useWorkspace((state) => state.removeProject);
  const included = files.filter((file) => file.included).length;
  return (
    <li className="project-group">
      <div className="project-head">
        <button
          type="button"
          className="btn-icon btn-icon-quiet"
          aria-expanded={open}
          aria-label={open ? `Collapse ${project.name}` : `Expand ${project.name}`}
          onClick={() => setOpen(!open)}
        >
          {open ? <CaretDown aria-hidden /> : <CaretRight aria-hidden />}
        </button>
        <FolderSimple aria-hidden />
        <span className="project-name" title={project.name}>
          {project.name}
        </span>
        <span className="muted small">
          {included} of {files.length}
        </span>
        <button
          type="button"
          className="btn-icon btn-icon-quiet"
          aria-label={`Remove ${project.name}`}
          onClick={() => removeProject(project.id)}
        >
          <Trash aria-hidden />
        </button>
      </div>
      {open && (
        <>
          <div className="project-tools">
            <button
              type="button"
              className="link-button"
              onClick={() => setIncluded(project.id, true)}
            >
              Include all
            </button>
            <button
              type="button"
              className="link-button"
              onClick={() => setIncluded(project.id, false)}
            >
              Include none
            </button>
            {project.excluded.length > 0 && (
              <button
                type="button"
                className="link-button"
                onClick={() => setShowSkipped(!showSkipped)}
              >
                {showSkipped ? "Hide" : "Show"} {project.excluded.length} skipped
              </button>
            )}
          </div>
          <ul className="file-list">
            {files.map((file) => (
              <FileRow key={file.id} source={file} nested />
            ))}
          </ul>
          {showSkipped && (
            <ul className="skipped-list">
              {project.excluded.map((entry) => (
                <li key={entry.path}>
                  <span>{entry.path}</span>
                  <span className="muted">{EXCLUSION_LABELS[entry.reason]}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  );
}

export function FileList() {
  const sources = useWorkspace((state) => state.sources);
  const projects = useWorkspace((state) => state.projects);
  const rejected = useWorkspace((state) => state.rejected);
  const dismissRejected = useWorkspace((state) => state.dismissRejected);
  const standalone = sources.filter((source) => source.projectId === null);
  const included = sources.filter((source) => source.included).length;

  return (
    <section className="pane pane-files" aria-labelledby="files-heading">
      <header className="pane-head">
        <h2 id="files-heading">Files</h2>
        <span className="muted small">
          {included} of {sources.length} included
        </span>
      </header>
      <AddButtons compact />
      {rejected.length > 0 && (
        <div className="callout callout-warn" role="status">
          <p>
            <strong>Not added</strong>
          </p>
          <ul className="plain-list">
            {rejected.map((item, index) => (
              <li key={`${item.name}-${index}`}>
                {item.name}: {item.reason}
              </li>
            ))}
          </ul>
          <button type="button" className="link-button" onClick={dismissRejected}>
            Dismiss
          </button>
        </div>
      )}
      <ul className="file-list">
        {standalone.map((source) => (
          <FileRow key={source.id} source={source} />
        ))}
        {projects.map((project) => (
          <ProjectGroup
            key={project.id}
            project={project}
            files={sources.filter((source) => source.projectId === project.id)}
          />
        ))}
      </ul>
    </section>
  );
}
