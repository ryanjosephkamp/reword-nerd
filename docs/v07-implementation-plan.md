# reword-nerd v0.7 — Updates, Community Feedback, Sharing, and Release Media

## Global constraints

- Release application/package version `0.7.0`; package manifest schema remains
  `6`, and workbook progress schema remains `1`.
- Preserve the browser-only workbench: no backend, model/provider calls,
  accounts, analytics, telemetry, remote assets, service worker, or new
  uploaded-document persistence. The sole browser-storage key remains
  `reword-nerd:preferences:v1`.
- Build real static GitHub Pages routes under `/reword-nerd/updates/`; do not
  add SPA/hash routing. All public update media is same-origin and synthetic.
- Use test-first development, deterministic generators, safe Markdown without
  raw HTML/MDX, and human-reviewed release prose. Do not auto-commit or let a
  workflow write to `main`.
- Preserve Night Terminal styling and accessibility at 320, 360, 390, 412,
  tablet, and desktop widths.

## Task 1: Static Updates engine, release ledger, and v0.7 content

- Introduce a JSON-authoritative `ReleaseLedgerV1` with safe release/article
  entries, SemVer/release classification, status, dates, author/tags, related
  PRs, Markdown path, visual-change declaration, video policy/exemption, and
  optional local video/poster/transcript metadata.
- Add deterministic commands:
  - `updates:new -- --slug ... --title ... --date YYYY-MM-DD`
  - `release:prepare -- --version X.Y.Z --title ... --date YYYY-MM-DD`
  - `updates:check`
  - `updates:render`
- `release:prepare` updates package/lock and centralized version contracts,
  classifies feature versus maintenance releases, scaffolds a builder's-journal
  post and review inventory, is idempotent, refuses to overwrite edited prose,
  and fails clearly when required Git history is unavailable. It makes no
  network, model, commit, push, or GitHub API call.
- Build validation fails for missing/current draft releases, placeholders,
  invalid ledgers or Markdown, unsafe/remote media, broken paths, or version
  disagreement. Production build validates, runs Vite, and renders static
  Updates files into `dist`.
- Generate `/updates/`, `/updates/road-to-v0-6/`,
  `/updates/v0-7-0/`, `/updates/feed.xml`, and sitemap entries with semantic
  HTML, canonical/OG/Twitter metadata, Blog/BlogPosting JSON-LD, RSS summaries,
  same-origin assets, and no required client JavaScript.
- Adopt the first-person builder's-journal template: At a glance; Added,
  Changed, Fixed; Why this matters; See it in action; How to use it;
  Compatibility and limitations; Privacy; Verification; What comes next;
  Feedback and contribution links.
- Launch with a curated Road to v0.6 retrospective plus the full v0.7 post.

## Task 2: Community foundation and share interactions

- Add structured GitHub Issue forms for bug reports and feature requests using
  existing `bug` and `enhancement` labels; disable public blank issues. Require
  search and privacy confirmations and prohibit source documents, packages,
  prompts, credentials, and confidential material.
- Add `SECURITY.md`, private-vulnerability-reporting guidance, `FUNDING.yml`,
  and a pull-request template. Retain and cross-link the existing Code of
  Conduct and Contributing guide. Do not add Discussions or a roadmap.
- Refactor Info into Product, Community, and Creator groups with Updates,
  Repository, Report a bug, Suggest a feature, Security reporting, profile,
  Website, and Sponsor actions. Add feedback actions to Help and Updates
  footers.
- Add a Phosphor ShareNetwork action after Info on desktop and to the mobile
  menu; add Share controls to Updates archive/posts. Share only canonical clean
  URLs, never session/query/hash state.
- Use `navigator.share()` only after direct activation; cancellation is silent.
  Otherwise reuse clipboard fallback, then expose a focused selectable URL if
  copying also fails. Announce success/fallback accessibly. Add no counters,
  trackers, URL shorteners, or social SDKs.
- Make the workbench footer version a link to the current release post and add
  Updates discovery to Info; mobile discovery stays in Info.

## Task 3: Parameterized Remotion release clip and embedded media

- Extend the existing Remotion source with a `ReleaseUpdate` composition at
  1280x720, 30fps, approximately 20–30 seconds, using validated Zod parameters
  and separate editable scenes for title, context, demonstration, highlights,
  and feedback CTA.
- Use frame-driven Remotion animation, Night Terminal styling, synthetic data,
  generous video-safe areas, and no audio/music. Keep existing tutorial media
  unchanged.
- Add `updates:video -- --version X.Y.Z` and `updates:video:check`; render v0.7
  H.264 MP4, WebM, metadata-free WebP poster, and transcript. Track only final
  assets; ignore/remove intermediate output.
- Enforce per-release budgets: WebM <=1.5 MiB, MP4 <=2 MiB, poster <=100 KiB,
  aggregate <=3.5 MiB.
- Require video for visual feature releases and visual maintenance releases;
  permit a nonvisual feature exemption only with a public reason. Embed with
  native controls, muted, playsInline, preload=none, no autoplay, transcript,
  fallback, and reduced-motion poster behavior.
- The v0.7 clip demonstrates Updates, feedback links, and Share.

## Task 4: Integrated QA, documentation, publication, and live verification

- Update README, Contributing, architecture, privacy, design system, directory
  structure, and release workflow documentation. State that public authored
  Updates/media are distinct from uploaded session content.
- Add unit/component/browser tests for ledger/generator determinism and errors,
  version sync, hostile Markdown/HTML, static routes and metadata, feed/sitemap,
  Issue forms, community links, share fallbacks/focus, video policy/media
  budgets, direct route reload, responsive accessibility, and same-origin-only
  network behavior. Preserve all workbench/package/schema-v6 regressions.
- Run `npm ci`, lint, typecheck, the full unit suite, Pages-base production
  build, complete Chromium suite, media inspection, link/feed validation,
  privacy/internal-artifact scans, and `git diff --check`.
- Start from freshly verified `origin/main` on
  `codex/v07-updates-community`; push, open a reviewed PR, wait for CI, merge,
  monitor Pages, enable/verify private vulnerability reporting, and verify the
  live workbench, Updates archive/post/feed/media, Issue forms, Share, and
  canonical deep links.

## Explicitly deferred

- Re-recording Quick Start/Help tutorial clips.
- The one-minute YouTube marketing video with music.
- A broader standalone launch essay beyond the v0.7 builder's-journal post.
