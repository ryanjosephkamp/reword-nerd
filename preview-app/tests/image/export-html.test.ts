import {
  IMAGE_FULL_HTML_MAX_BYTES,
  decideImageFullHtmlSize,
  renderImageFullHtml,
  renderImagePairHtml,
  renderImageRootHtml,
  type ImageHtmlPair,
} from "../../src/image/export";

const hostile = `</script><img src=x onerror="alert('&')"> ../ é`;

function pair(overrides: Partial<ImageHtmlPair> = {}): ImageHtmlPair {
  return {
    ordinal: 1,
    key: "001-example",
    displayName: hostile,
    sourceReference: "pairs/001-example/source.png",
    sourceBytes: new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }),
    mimeType: "image/png",
    provenanceLabel: `Folder & ${hostile}`,
    profileLabel: `Model "${hostile}`,
    prompt: `Prompt ${hostile}`,
    runCard: `Run card ${hostile}`,
    warnings: [`Warning ${hostile}`],
    officialSourceUrls: [`https://example.invalid/?q=${hostile}`],
    ...overrides,
  };
}

describe("portable Image package HTML", () => {
  it("renders responsive root and per-pair cards with local fallbacks and no table", () => {
    // Catches a wide table, missing portable paths, or inaccessible source fallback controls.
    const root = renderImageRootHtml([pair()]);
    const individual = renderImagePairHtml(pair({ sourceReference: "./source.png" }));
    for (const html of [root, individual]) {
      expect(html).toContain("<!doctype html>");
      expect(html).toContain('content="width=device-width, initial-scale=1"');
      expect(html).toContain("image-package-card");
      expect(html).not.toContain("<table");
      expect(html).toContain('draggable="true"');
      expect(html).toContain("COPY PROMPT");
      expect(html).toContain("COPY IMAGE");
      expect(html).toContain("OPEN IMAGE");
      expect(html).toContain("DOWNLOAD IMAGE");
      expect(html).toContain('role="status"');
    }
    expect(root).toContain('src="pairs/001-example/source.png"');
    expect(individual).toContain('src="./source.png"');
  });

  it("escapes hostile dynamic text and keeps it out of the static script", () => {
    // Catches source/OCR/profile text breaking out of DOM text or entering executable JavaScript.
    const html = renderImageRootHtml([pair()]);
    expect(html).not.toContain(hostile);
    expect(html).toContain("&lt;/script&gt;&lt;img src=x onerror=&quot;alert(&#39;&amp;&#39;)&quot;&gt;");
    const script = html.match(/<script>([\s\S]*?)<\/script>/u)?.[1] ?? "";
    expect(script).not.toContain("example.invalid");
    expect(script).not.toContain("onerror");
    expect(script).toContain("textContent");
  });

  it("rejects nonlocal or malformed public source references", () => {
    // Catches public render helpers emitting active or remote href/src values supplied by JavaScript callers.
    for (const sourceReference of [
      "javascript:alert(1)",
      "https://example.invalid/private.png",
      "pairs/001-example/../../private.png",
      "data:text/html;base64,PGgxPkJvb208L2gxPg==",
    ]) {
      expect(() => renderImageRootHtml([pair({ sourceReference })])).toThrow("IMAGE_HTML_SOURCE_REFERENCE_INVALID");
      expect(() => renderImagePairHtml(pair({ sourceReference }))).toThrow("IMAGE_HTML_SOURCE_REFERENCE_INVALID");
    }
  });

  it("ships a restrictive local CSP and no network, storage, model, tracking, or auto-upload surface", () => {
    // Catches portable HTML gaining a remote side effect or hidden persistence path.
    const html = renderImageRootHtml([pair()]);
    expect(html).toContain("default-src &#39;none&#39;");
    expect(html).toContain("connect-src &#39;none&#39;");
    expect(html).toContain("object-src &#39;none&#39;");
    expect(html).toContain("form-action &#39;none&#39;");
    expect(html).not.toMatch(/\bfetch\s*\(/u);
    expect(html).not.toMatch(/XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|serviceWorker/u);
    expect(html).not.toMatch(/<(?:link|iframe|script)\s[^>]*(?:src|href)=/u);
    expect(html).toContain("https://example.invalid/?q=");
    expect(html).not.toContain('href="https://example.invalid');
  });

  it("makes the full artifact self-contained with deterministic data URLs", async () => {
    // Catches OPEN-ME-FULL retaining a sibling-file dependency.
    const result = await renderImageFullHtml([pair()]);
    expect(result.status).toBe("generated");
    if (result.status !== "generated") return;
    expect(result.html).toContain('src="data:image/png;base64,iVBORw=="');
    expect(result.byteCount).toBe(new TextEncoder().encode(result.html).byteLength);
    expect(result.html).not.toContain("pairs/001-example/source.png");
  });

  it("stops full-HTML source reads at an abort boundary", async () => {
    // Catches a cancelled 100-image build continuing to read and base64-encode later owned Blobs.
    const controller = new AbortController();
    const firstSource = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
    Object.defineProperty(firstSource, "arrayBuffer", {
      value: async () => {
        controller.abort();
        return new Uint8Array([137, 80, 78, 71]).buffer;
      },
    });
    const secondRead = vi.fn(async () => new Uint8Array([137, 80, 78, 71]).buffer);
    const secondSource = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
    Object.defineProperty(secondSource, "arrayBuffer", { value: secondRead });

    await expect(renderImageFullHtml([
      pair({ sourceBytes: firstSource }),
      pair({ ordinal: 2, key: "002-second", sourceReference: "pairs/002-second/source.png", sourceBytes: secondSource }),
    ], controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(secondRead).not.toHaveBeenCalled();
  });

  it("includes exactly 32 MiB and omits 32 MiB plus one without allocating a large fixture", () => {
    // Catches an off-by-one or late allocation at the full-HTML safety boundary.
    const source = { byteCount: 3, mimeType: "image/png" as const };
    const sourceContribution = 3 * ("data:image/png;base64,".length + 4);
    expect(decideImageFullHtmlSize(IMAGE_FULL_HTML_MAX_BYTES - sourceContribution, [source])).toEqual({
      status: "generated",
      projectedByteCount: IMAGE_FULL_HTML_MAX_BYTES,
    });
    expect(decideImageFullHtmlSize(IMAGE_FULL_HTML_MAX_BYTES - sourceContribution + 1, [source])).toEqual({
      status: "omitted",
      projectedByteCount: IMAGE_FULL_HTML_MAX_BYTES + 1,
    });
  });
});
