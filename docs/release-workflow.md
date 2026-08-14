# Release workflow

This is the local, reviewable v0.7 release procedure for the static Updates
journal. It separates authoring evidence from remote publication authority.
Running a local command does not publish, commit, push, merge, open a pull
request, change a GitHub setting, or deploy.

The current application has a physical default Text page and a physical Image
companion at `/reword-nerd/image/`. Image publication remains a separate owner-authorization gate; documenting or locally validating the page does not
release it. The Image Quick Start now embeds a silent video hosted locally as same-origin media, with a poster and transcript; the Image Updates entry, separate release-update media,
version change, merge, and Pages deployment remain separately gated.

## Scope and custody

Public authored Updates posts and release media are site material, distinct from
uploaded session content, prompt packages, and downloaded progress copies.
Release sources are reviewed Markdown and a JSON ledger; visual assets use only
synthetic data. Do not copy a selected file, prompt, package, response, or
credential into a post, transcript, poster, or release clip. Do not include an
authored Updates asset in a user ZIP.

## 1. Prepare the local checkout

Start from the intended reviewed branch and use the lockfile exactly:

```sh
npm ci
git status --short --branch
```

Confirm the branch, ancestry, and uncommitted paths before authoring. A local
checkout and its Git history are evidence for review inventory only; they are
not publication authority.

## 2. Author the ledger and journal entry

For a new release, scaffold from local Git history and then write human-reviewed
prose. The generator refuses to replace edited prose on a repeated run.

```sh
npm run release:prepare -- --version X.Y.Z --title "reword-nerd vX.Y: concise title" --date YYYY-MM-DD
npm run updates:check
```

Keep `content/updates/releases.json` JSON-authoritative. Check the version,
classification, current/draft status, date, author, tags, Markdown path, visual
change declaration, related PR numbers, and video policy against the package,
lockfile, `src/version.ts`, and schema-v6 contracts. Write all builder's-journal
sections in reviewed safe Markdown; raw HTML, MDX, placeholders, remote media,
and unapproved links are rejected.

Use a terse, neutral changelog voice throughout public post bodies. Prefer
action-led fragments such as “Added …”, “Changed …”, and “Fixed …”; do not use
first-person singular pronouns (`I`, `me`, `my`, `mine`, or `myself`). The
authoring commands scaffold this voice, and production validation rejects posts
that drift back to first-person singular prose.

## 3. Create and review release media when required

Visual feature and visual maintenance releases require a final same-origin MP4,
WebM, WebP poster, and transcript. A nonvisual feature may use a public
exemption reason; a nonvisual maintenance release uses no video. Render and
validate locally:

```sh
npm run updates:video -- --version X.Y.Z
npm run updates:video:check
```

Inspect the final media sizes and metadata, the poster, and at least one
representative frame from each editable scene. Confirm 1280x720, 30fps,
approximately 20–30 seconds, no audio, no source/session material, readable
safe areas, native muted/inline/non-autoplay controls, transcript, and
reduced-motion poster behavior. Keep only reviewed final assets under
`public/media/updates/<release>/`; intermediate renders are not release assets.

## 4. Run local release gates

Run focused tests while changing a contract, then run the complete local set:

```sh
npm run lint
npm run typecheck
npm test -- --run
VITE_BASE_PATH=/reword-nerd/ npm run build
PLAYWRIGHT_BASE_PATH=/reword-nerd/ PLAYWRIGHT_USE_PREVIEW=1 npm run e2e
git diff --check
```

The base-path build transitively runs `npm run updates:check` and
`npm run updates:video:check` before rendering the static archive, post, feed,
and sitemap. Inspect direct `/reword-nerd/updates/` and post reloads, feed and
media paths, canonical/metadata output, Share's native/clipboard/manual paths,
reduced-motion poster, responsive containment, accessibility, and same-origin
request/storage behavior. Review the ledger, post, feed, sitemap, rendered
pages, browser screenshots, and media poster/representative frames rather than
relying on a passing command alone.

## 5. Owner-controlled remote publication

Only an authorized owner may separately decide to create a commit, push it,
open or approve a pull request, merge, enable or verify private vulnerability
reporting, or publish/deploy GitHub Pages. Before that decision, review the
exact staged diff, source-custody boundary, private repository identity, and
the read-only verification results. The repository workflow uses `npm ci`,
lint, typecheck, the unit suite, and the Pages-base build; that build already
enforces Updates/video validation. It does not grant a local author permission
to perform a remote action.

After an authorized merge and Pages deployment, the owner should verify both
physical workbench pages, direct `/reword-nerd/image/` reloads, the archive,
post, feed, media, Issue forms, community links, each clean canonical Share URL,
and the absence of unexpected external requests.
