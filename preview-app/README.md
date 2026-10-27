# reword-nerd workspace preview

Review documents, images, and projects, prepare exact canonical prompt packages, and inspect retained results in a shared workspace. The standalone preview supports manual preparation and exports. Connected runs use the companion's own loopback UI and the official execution harness.

## Local use

Run `npm ci`, then `npm run dev` in this directory. `npm run build` produces a standalone build. From the repository root, `node scripts/build-preview.mjs` builds the classic site and adds the independent preview under `/preview/`, verifying that classic output bytes are unchanged.

For the companion, build with the default `/` base and run `node local-companion/cli.mjs --state /absolute/path/reword-state`. It starts in review-only mode. Reuse the same owned state directory to recover workspace snapshots after a port change. New execution requires an explicitly enabled, verified adapter and a fresh outgoing review. The existing adapters are pinned to Codex CLI 0.153.4 and its verified binary; other runtimes remain unavailable until their input and tool boundaries are validated. No automatic substitution occurs.

## Remembering and recovery

Choose **Remember this workspace on this device** to autosave local work. The saved workspace includes original files, reviewed text and OCR, images/projects, settings, selections, prompt edits, responses, packages, imported reviews, decisions, and job references. Recovery never starts or resumes execution. Outgoing confirmations are cleared, and running references remain uncertain until current status is available.

Workspace options provide pause, portable export/import, latest/previous recovery, and removal of saved copies. Removing snapshots preserves open work, job records, and dispatch claims. Keep a portable export when a browser profile or device may be cleared. Provider credentials and launch-session secrets are outside saved workspaces.

Saves are limited to 512 MiB, including 32 MiB of structured metadata/text, 120,000 graph nodes, and 4,096 binary records. One previous snapshot is retained. Oversized, corrupt, unsupported, denied, full, or conflicting storage fails visibly and preserves the last confirmed save. The preview uses an independent browser-storage namespace and does not migrate classic portal preferences.

## Runtime choices

Conversation-model choice, prompt-family guidance, and the image generator are separate. The current supported Codex adapter does not establish a separate image-generator/version selector. The generator remains managed by Codex, and its actual version is unknown when the harness does not expose it. Automatic image-result return is unavailable; image output review remains in the harness.
