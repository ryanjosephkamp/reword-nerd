# Contributing to reword_nerd

Thanks for helping. Bug reports, ideas, and pull requests are all welcome.

## Setup

Use Node.js 22 or later.

```sh
git clone https://github.com/ryanjosephkamp/reword-nerd.git
cd reword-nerd
npm install
npm run dev
```

Before opening a pull request, run `npm run check` and, for interface changes, `npm run e2e`
(run `npx playwright install chromium` once first).

## What fits

- Better prompts and task instructions in `src/engine/prompts/` and `src/engine/handoff/`.
- Support for more file formats, or better reading of the ones already supported.
- New destinations (agents, chat apps, or image tools) with a verified way to hand work to them.
- Accessibility, phone layout, and speed improvements.
- Tests and clearer wording.

reword_nerd stays a browser-only tool: no server, no account, no analytics, and no calls to
model providers. Please open an issue to discuss anything that would change that.

## Guidelines

- Keep documents inert: nothing a user adds should be executed, fetched from, or allowed to load
  remote resources.
- Load heavy libraries only inside the function that needs them, so the app stays fast to open.
- Use synthetic test files only. Never include real documents, credentials, or personal data.
- Write interface text in plain American English.
