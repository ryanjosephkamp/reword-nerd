# Road to v0.6

## At a glance

I started reword-nerd as a focused way to turn source material into inspectable rewriting prompts. By v0.6, it had become a local browser workspace that could review individual documents and bounded project trees without sending their contents to a server.

## Added

- I added guided model profiles, package previews, OCR review, LaTeX handling, and Markdown-aware media extraction.
- I added One-shot and four-stage Manual workflows with deterministic workbooks and progress copies.
- I added project workspaces for folders and ZIP files, including source viewers, reviewed text, exclusions, and tree-level integrity records.

## Changed

- I moved the product toward a dense Night Terminal workbench that remains usable from narrow mobile screens through desktop layouts.
- I centralized release versions and evolved the package manifest deliberately through schema 6 while keeping workbook progress at schema 1.
- I made generated archives easier to inspect offline with an opening guide, runbook, manifests, and companion HTML workbooks.

## Fixed

- I tightened mobile scrolling, preview layout, settings placement, and source-review navigation across several small releases.
- I closed gaps where unsafe project entries, stale review state, or changed source bytes could have entered an export.
- I removed an internal implementation artifact that had been published accidentally and added that lesson to the release checklist.

## Why this matters

I want the workbench to make AI-assisted rewriting more legible. The source, prompt instructions, review decisions, expected outputs, and package hashes should stay visible enough that a person can understand what they are about to send elsewhere.

## See it in action

The workbench includes short, same-origin demonstration clips for the document review, package, overview, and settings flows. They use synthetic material and do not load a third-party player.

## How to use it

Open the workbench, add a supported file or project, review the extracted text and settings, then export a deterministic prompt package. The package tells you which prompt to run, where to place the response, and how to verify the result before applying it.

## Compatibility and limitations

The browser handles the processing locally, so large inputs remain bounded by device memory and explicit intake limits. OCR and project classification still require human review. The generated package coordinates work with a model, but reword-nerd does not execute that model or apply its answer to your source.

## Privacy

Document and project contents remain in memory for the current browser session. The only persistent browser key stores validated preferences and tutorial state. There are no accounts, analytics, telemetry, provider credentials, backend uploads, remote assets, or service worker.

## Verification

Each release was checked with focused unit tests, TypeScript, lint, production builds, and Chromium browser flows appropriate to its scope. Deterministic package tests cover stable paths, timestamps, hashes, compression choices, schema contracts, and privacy boundaries.

## What comes next

I am adding a static Updates journal so release notes and verification can live beside the workbench without introducing a publishing backend or client-side router.

## Feedback and contribution links

- [Open an issue](https://github.com/ryanjosephkamp/reword-nerd/issues)
- [Read the contribution guide](https://github.com/ryanjosephkamp/reword-nerd/blob/main/CONTRIBUTING.md)
