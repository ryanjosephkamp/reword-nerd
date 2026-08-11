# Privacy and local-processing boundary

`reword-nerd` processes the files you select in the current browser session.
Validation, text extraction, hashing, review edits, prompt generation, package
preview, clipboard handling, and ZIP creation run locally in the browser.

## What the application does not do

- It has no application backend or account system.
- It does not send the selected files to a model provider.
- It does not include analytics, telemetry, remote assets, or post-load
  external application requests. The local PDF parser may load same-origin
  application assets on demand.
- It does not write workbench data to localStorage, sessionStorage, IndexedDB,
  Cache Storage, cookies, or a service worker.

The selected model profile is a label and workflow aid. It never establishes a
provider connection or transmits a document.

## Session lifetime

The application state lives only in memory. Refreshing or closing the page
clears the queue, extraction edits, settings, acknowledgements, and generated
download state. A before-unload prompt may appear when a browser considers the
current workbench state changed; it does not save the session.

## Download boundary

When you choose **BUILD PACKAGE**, the browser creates a local ZIP Blob and
structured preview artifacts in memory; it does not download them. Choosing
**DOWNLOAD ZIP** explicitly begins a normal browser download of that same Blob.
After that point, the file is handled by your
browser, its configured download destination, and your operating system. The
application does not retain a copy after the session ends.

The standalone HTML companion contains inline CSS and a small inline copy
script. It has no external fonts, images, libraries, analytics, storage, or
network requests. Copy uses the browser Clipboard API where available and a
local selection fallback otherwise.

## Your manual model workflow

Opening the exported prompts with a model is a separate action under the
terms, privacy settings, and account controls of the model service you choose.
Review the package before sharing it and use a provider appropriate for the
document's sensitivity.

## Scope of this statement

This statement describes the application bundle and its runtime behavior. Your
static host receives ordinary requests for the application HTML, scripts,
styles, and local PDF worker. It does not receive the documents selected in the
workbench. Your local development server, browser extensions, corporate device
management, and network environment may have their own logging or handling
policies.
