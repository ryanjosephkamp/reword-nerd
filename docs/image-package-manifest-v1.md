# Image reference prompt package — manifest schema 1

This specification covers the Image companion's deterministic
`image-reference-prompt-package`. It is independent from the Text workbook's
schema 6 and from the application version. One
`reword-nerd-image-prompt-package.zip` is built for the confirmed image set; it
contains one source image and one exact prompt per included pair, plus a
provider run card.

Build creates the ZIP in memory. Download is a separate deliberate action that
is available only while the built output still matches the current confirmed
revision. A source, OCR, inclusion, or configuration change cancels or clears
stale work and invalidates both the ZIP and preview cards.

## Archive tree

Entries use portable, collision-safe pair keys in confirmed queue order:

```text
reword-nerd-image-prompt-package.zip
├── README.md
├── OPEN-ME.html
├── OPEN-ME-FULL.html          # present only when encoded HTML is <= 33,554,432 bytes
├── manifest.json
└── pairs/
    └── 001-safe-name/
        ├── source.<ext>
        ├── prompt.txt
        ├── run-card.md
        ├── metadata.json
        └── OPEN-ME.html
```

The representative source path is
`pairs/001-safe-name/source.<ext>`. Each real extension is one of `png`, `jpg`,
`jpeg`, `webp`, or `avif`. There are no explicit ZIP directory entries.

## Manifest identity and top-level fields

`manifest.json` is UTF-8 JSON with schema version `1` and these top-level
members, in order:

1. `schemaVersion`
2. `package`
3. `privacy`
4. `rootArtifacts`
5. `pairs`
6. `artifactInventory`
7. `manifestSelfRecord`

`package` records the `reword-nerd` name, the
`image-reference-prompt-package` format,
`reword-nerd-image-prompt-package.zip` filename, fixed timestamp
`1980-01-01T00:00:00.000Z`, pair count, and
`confirmed-queue-order` ordering rule.

`privacy` records `generatedLocally: true`, `automaticUploads: false`,
`networkRequests: false`, `sourceBytesMayRetainExifOrLocation: true`, and
`originalContainersIncluded: false`.

`rootArtifacts` records the root README and lightweight HTML. It also records
whether `OPEN-ME-FULL.html` was generated or omitted. The full, self-contained
HTML ceiling is exactly 33,554,432 bytes; an omitted record uses the
`encoded-size-limit` reason.

`pairs` preserves confirmed queue order. Each pair records its ordinal, key,
display name, exact source path/type/extension/size/SHA-256/dimensions and safe
provenance; settings and versioned profile snapshot; accepted-OCR status and
text hash/count when applicable; warnings; and records for all five pair
artifacts. Accepted OCR text appears literally in the exact prompt but not as a
free-standing manifest value.

`artifactInventory` is sorted by portable archive path and records the path,
byte count, SHA-256, and media type of every non-manifest artifact. The manifest
cannot contain a stable hash of itself, so `manifestSelfRecord` is exactly
`{ "path": "manifest.json", "sha256": null, "reason": "self-referential-artifact" }`.

## Deterministic bytes and independent validation

Before export, the builder deep-snapshots the confirmed revision and
independently revalidates source signatures, MIME/extension coherence,
dimensions, byte and session limits, exact source SHA-256 values, provenance
shapes and paths, settings, accepted OCR, and profile versions. Original PDF, DOCX, and ZIP containers are never included or exported. Direct-image and
recoverable DOCX-media bytes remain exact; PDF visuals and page captures are
locally rasterized and encoded as PNG recovery output.

For identical validated input and profile versions, the archive has
deterministic bytes:

- entries are sorted by portable path and emitted without directory entries;
- every entry uses fixed ZIP time `1980-01-01T00:00:00.000Z`, an extended
  timestamp, regular-file mode `100644`, no comment, and no data descriptor;
- exact source image bytes use `STORE` compression;
- generated UTF-8 text, Markdown, JSON, and HTML use `DEFLATE` level 9;
- generated text uses LF endings, JSON uses two-space indentation, and every
  artifact hash is SHA-256;
- repeat builds of the same confirmed snapshot must be byte-for-byte identical.

Source and package hashing and archive writes are cancellation-aware between
asynchronous operations. A superseded generation cannot repopulate Ready state.

## Offline HTML and clipboard fallbacks

Root `OPEN-ME.html` references sibling pair images and works after extracting
the ZIP. Each pair `OPEN-ME.html` references its local `./source.<ext>`.
`OPEN-ME-FULL.html`, when present, embeds bounded image data URLs. The responsive
cards show provenance, profile, run card, exact prompt, and a draggable source.

The HTML uses a restrictive content security policy, performs no network request,
tracking write, storage operation, automatic upload, credential
request, or model call. It remains usable under `file://`:

- if Copy Prompt cannot use Clipboard, it selects the visible prompt for manual copy;
- if Copy Image is unavailable, Open Image, Download Image, and drag remain available;
- every transfer still requires an explicit user action.

## Source custody

Direct-image and recoverable DOCX-media bytes are preserved exactly, so they
may retain EXIF or location metadata. PDF visuals and page captures are locally
rasterized and encoded as PNG rather than preserving original PDF image-stream
bytes. Users should inspect source custody before sharing a package. The package
does not retain the original PDF/DOCX/ZIP container, make a provider request,
or guarantee that any external generator will reproduce an image identically.
