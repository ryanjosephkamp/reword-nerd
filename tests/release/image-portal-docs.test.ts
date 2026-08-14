import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

describe("completed Image companion documentation contract", () => {
  it("maps the physical companion page without changing the Text default or release version", () => {
    // Catches the shipped Image page remaining undiscoverable or being described as a router alias/replacement.
    for (const path of [
      "README.md",
      "PRODUCT.md",
      "CONTRIBUTING.md",
      "docs/architecture.md",
      "docs/design-system.md",
      "docs/design-principles.md",
      "docs/design-qa.md",
      "docs/directory-structure.md",
      "docs/extraction-limitations.md",
      "docs/implementation-plan.md",
      "docs/privacy.md",
      "docs/release-workflow.md",
      "docs/image-package-manifest-v1.md",
    ]) expect(existsSync(join(root, path))).toBe(true);

    const readme = read("README.md");
    expect(readme).toContain("/reword-nerd/image/");
    expect(readme).toMatch(/Text[^\n]*(?:default|root)|(?:default|root)[^\n]*Text/iu);
    expect(readme).toMatch(/Image[^\n]*(?:companion|separate page)|(?:companion|separate page)[^\n]*Image/iu);
    expect(readme).toMatch(/Text workbook[^\n]*(?:schema 6|schema-6)|(?:schema 6|schema-6)[^\n]*Text workbook/iu);
    expect(readme).toMatch(/one ZIP[^\n]*confirmed (?:image )?set[^\n]*one pair per included image/iu);

    const architecture = read("docs/architecture.md");
    expect(architecture).toContain("image/index.html");
    expect(architecture).toContain("src/image/");
    expect(architecture).toMatch(/sibling Image (?:domain|reducer)/iu);
    expect(architecture).toMatch(/Text[^\n]*(?:unchanged|isolated)|(?:unchanged|isolated)[^\n]*Text/iu);

    const directory = read("docs/directory-structure.md");
    for (const path of ["image/index.html", "src/image/", "tests/image/", "image-package-manifest-v1.md"]) {
      expect(directory).toContain(path);
    }
    expect(directory).toContain("public/image/orange-pyramid.webp");
    expect(directory).toMatch(/└── tests\/\n\s+├── image\//u);

    expect(JSON.parse(read("package.json")).version).toBe("0.7.0");
    for (const path of ["README.md", "PRODUCT.md", "docs/architecture.md", "docs/implementation-plan.md"]) {
      expect(read(path)).not.toContain("0.8.0");
    }
  });

  it("documents exact local intake, limits, OCR review, and custody boundaries", () => {
    // Catches docs implying unsupported formats, remote processing, silent OCR, or unbounded image retention.
    const extraction = read("docs/extraction-limitations.md");
    for (const format of ["PNG", "JPEG", "WebP", "AVIF", "PDF", "DOCX", "folder", "ZIP"]) {
      expect(extraction).toContain(format);
    }
    for (const rejected of ["SVG", "GIF", "BMP", "TIFF", "HEIC", "nested archives"]) {
      expect(extraction).toContain(rejected);
    }
    for (const limit of ["100 retained images", "20 MiB", "100 MiB", "40 megapixels", "16,384", "500 entries", "100:1"]) {
      expect(extraction).toContain(limit);
    }
    expect(extraction).toMatch(/Image OCR[^\n]*off by default|off by default[^\n]*Image OCR/iu);
    expect(extraction).toMatch(/accepted OCR[^\n]*(?:prompt|package)|(?:prompt|package)[^\n]*accepted OCR/iu);
    expect(extraction).toMatch(/exact[^\n]*image bytes/iu);
    expect(extraction).toMatch(/EXIF[^\n]*location|location[^\n]*EXIF/iu);
    expect(extraction).toMatch(/folder[^\n]*(?:cannot|does not)[^\n]*(?:verify|detect)[^\n]*(?:symlink|link)/iu);
    expect(extraction).toMatch(/ZIP[^\n]*(?:link|encryption|nested|bomb)/iu);
    expect(extraction).toMatch(/128 MiB[^\n]*DecodeStream/iu);
    expect(extraction).toMatch(/160,000,000-byte[\s\S]{0,180}(?:base images|stream masks)/iu);
    expect(extraction).toMatch(/not a claim that every internal PDF\.js allocation/iu);
    expect(extraction).toMatch(/Embedded PDF candidates[\s\S]{0,160}(?:queue|package) order/iu);
    expect(extraction).toMatch(/capture page pixels[\s\S]{0,300}before embedded recovery/iu);

    const privacy = read("docs/privacy.md");
    expect(privacy).toContain("reword-nerd:preferences:v1");
    expect(privacy).toContain("reword-nerd:image-preferences:v1");
    expect(privacy).toMatch(/exactly two[^\n]*(?:localStorage|saved-preference)/iu);
    expect(privacy).toMatch(/object URL[^\n]*(?:revoke|release|dispose)/iu);
    expect(privacy).toMatch(/original (?:PDF|DOCX)[^\n]*(?:not|never)[^\n]*(?:export|include)|(?:not|never)[^\n]*(?:export|include)[^\n]*original (?:PDF|DOCX)/iu);
    expect(privacy).toMatch(/no model[^\n]*(?:call|request)|never calls[^\n]*model/iu);
    expect(privacy).toMatch(/no dedicated[^\n]*(?:filename|path)[^\n]*field/iu);
    expect(privacy).toMatch(/occurrence[^\n]*object URL[^\n]*remov/iu);
    expect(privacy).toMatch(/(?:built|package)[- ]card[^\n]*object URL[^\n]*(?:invalidat|replac)/iu);
    expect(privacy).toMatch(/all[^\n]*object URL[^\n]*(?:reset|navigation|unmount)/iu);
    expect(privacy).toMatch(/image-byte object URL[^\n]*(?:reset|navigation|unmount)/iu);
    expect(privacy).toMatch(/PDF parser[^\n]*Blob URL[^\n]*worker code[^\n]*no user image or document bytes/iu);

    const architecture = read("docs/architecture.md");
    expect(architecture).toMatch(/occurrence[\s\S]{0,120}object URL[\s\S]{0,120}remov/iu);
    expect(architecture).toMatch(/(?:built|package)[- ]card[\s\S]{0,120}object URL[\s\S]{0,120}(?:invalidat|replac)/iu);
    expect(architecture).toMatch(/all[\s\S]{0,120}object URL[\s\S]{0,120}(?:reset|navigation|unmount)/iu);

    for (const path of ["README.md", "docs/architecture.md", "docs/privacy.md", "CONTRIBUTING.md"]) {
      const source = read(path);
      const freeFormIndex = source.search(/free[- ]form/iu);
      expect(freeFormIndex).toBeGreaterThanOrEqual(0);
      const disclosure = source.slice(Math.max(0, freeFormIndex - 240), freeFormIndex + 360);
      expect(disclosure).toMatch(/requested[- ]changes|requested changes|must-preserve/iu);
      expect(disclosure).toMatch(/persist|save/iu);
    }
    expect(read("CONTRIBUTING.md")).not.toMatch(/UI[\s\S]{0,80}must warn|must warn[\s\S]{0,80}UI/iu);
  });

  it("records Image design semantics, profiles, and the one-image/one-prompt workflow", () => {
    // Catches the orange portal borrowing Text mint/review semantics or docs implying batch model execution.
    const design = read("docs/design-system.md");
    expect(design).toContain("#ff9f1c");
    expect(design).toContain("#ffd166");
    expect(design).toMatch(/orange[^\n]*(?:action|ready)|(?:action|ready)[^\n]*orange/iu);
    expect(design).toMatch(/yellow[^\n]*(?:review|pending)|(?:review|pending)[^\n]*yellow/iu);
    expect(design).toMatch(/visited[^\n]*orange|orange[^\n]*visited/iu);
    expect(design).toMatch(/Text[^\n]*teal|teal[^\n]*Text/iu);

    const principles = read("docs/design-principles.md");
    expect(principles).toMatch(/Text[^\n]*(?:root|default)[\s\S]*Image[^\n]*companion/iu);
    expect(principles).toMatch(/one source image[^\n]*one prompt/iu);
    expect(principles).toMatch(/local[^\n]*(?:browser|device)/iu);
    expect(principles).toMatch(/(?:clipboard|copy)[^\n]*drag[^\n]*open/iu);

    const product = read("PRODUCT.md");
    expect(product).toMatch(/(?:clipboard|copy)[^\n]*drag[^\n]*open/iu);

    const readme = read("README.md");
    for (const profile of [
      "OpenAI GPT Image",
      "Google Nano Banana",
      "xAI Grok Imagine",
      "Black Forest Labs FLUX",
      "Adobe Firefly",
      "Ideogram",
      "Midjourney",
      "Stability AI",
      "Other/Custom",
    ]) expect(readme).toContain(profile);
    expect(readme).toMatch(/one (?:prompt|pair)[^\n]*one (?:source )?image|one (?:source )?image[^\n]*one (?:prompt|pair)/iu);
    expect(readme).toMatch(/Faithful rendition/iu);
    expect(readme).toMatch(/does not[^\n]*(?:call|contact)[^\n]*(?:model|provider)|never[^\n]*(?:call|contact)[^\n]*(?:model|provider)/iu);
  });

  it("specifies the deterministic schema-1 Image archive and offline fallbacks", () => {
    // Catches schema drift, missing artifacts, or portable HTML being described as online/app-dependent.
    const manifest = read("docs/image-package-manifest-v1.md");
    for (const value of [
      "image-reference-prompt-package",
      "reword-nerd-image-prompt-package.zip",
      "1980-01-01T00:00:00.000Z",
      "OPEN-ME.html",
      "OPEN-ME-FULL.html",
      "manifest.json",
      "pairs/001-safe-name/source.<ext>",
      "prompt.txt",
      "run-card.md",
      "metadata.json",
      "manifestSelfRecord",
      "33,554,432",
      "sourceBytesMayRetainExifOrLocation",
      "originalContainersIncluded",
    ]) expect(manifest).toContain(value);
    expect(manifest).toMatch(/schema[^\n]*`?1`?/iu);
    expect(manifest).toMatch(/one[^\n]*source image[^\n]*one[^\n]*prompt/iu);
    expect(manifest).toMatch(/sorted[^\n]*(?:path|entry)/iu);
    expect(manifest).toMatch(/SHA-256/iu);
    expect(manifest).toMatch(/byte[- ](?:for[- ]byte|identical)|deterministic bytes/iu);
    expect(manifest).toMatch(/file:\/\//iu);
    expect(manifest).toMatch(/Copy Prompt[^\n]*(?:selection|manual)|(?:selection|manual)[^\n]*Copy Prompt/iu);
    expect(manifest).toMatch(/Copy Image[^\n]*(?:Open Image|Download Image|drag)|(?:Open Image|Download Image|drag)[^\n]*Copy Image/iu);
    expect(manifest).toMatch(/no network request/iu);
    expect(manifest).toMatch(/original (?:PDF|DOCX|ZIP)[^\n]*(?:not|never)[^\n]*(?:include|export)|(?:not|never)[^\n]*(?:include|export)[^\n]*original (?:PDF|DOCX|ZIP)/iu);
    expect(manifest).toMatch(/direct[\s\S]{0,120}DOCX[\s\S]{0,120}(?:preserv|exact)/iu);
    expect(manifest).toMatch(/PDF[\s\S]{0,160}(?:rasteriz|encoded)[\s\S]{0,80}PNG/iu);

    const directory = read("docs/directory-structure.md");
    expect(directory).toContain("reword-nerd-image-prompt-package.zip");
    expect(directory).toContain("pairs/<pair-key>/");
  });

  it("keeps Image release and visual review evidence truthful and separately gated", () => {
    const release = read("docs/release-workflow.md");
    expect(release).toContain("/reword-nerd/image/");
    expect(release).toMatch(/Image[^\n]*(?:release|publication)[^\n]*(?:separate|owner)[^\n]*(?:gate|authorization)/iu);
    expect(release).toMatch(/Quick Start[^\n]*(?:separate|later)[^\n]*(?:gate|task)/iu);
    expect(release).not.toMatch(/v0\.8[^\n]*(?:published|deployed|released)/iu);

    const qa = read("docs/design-qa.md");
    expect(qa).toMatch(/Image companion[^\n]*comparison ledger/iu);
    const imageLedger = qa.slice(qa.search(/Image companion[^\n]*comparison ledger/iu));
    expect((imageLedger.match(/^\|[^\n]*\|[^\n]*\|[^\n]*\|$/gmu) ?? []).length).toBeGreaterThanOrEqual(6);
    expect(imageLedger).toMatch(/Chromium-only/iu);
    expect(imageLedger).toContain("320 / 360 / 390 / 412");
    expect(imageLedger).not.toMatch(/\/Users\/|\/private\/|\/tmp\//u);
    expect(imageLedger).not.toMatch(/screenshot inspection/iu);

    const readme = read("README.md");
    expect(readme).toMatch(/Text[^\n]*first-visit Quick start[^\n]*video/iu);
    expect(readme).toMatch(/Image Quick Start[^\n]*(?:later|separate)[^\n]*(?:gate|task)/iu);

    for (const path of ["README.md", "docs/architecture.md", "docs/design-system.md"]) {
      expect(read(path)).not.toMatch(/(?<!Text )first-visit Quick start[^\n]*video/iu);
    }
  });
});
