import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { describe, expect, it } from "vitest";

describe("Image multi-page build", () => {
  it("emits direct and reloadable root and Image HTML entries under the Pages base path", async () => {
    // This catches an Image route that works only through dev-server fallback instead of as a physical static page.
    const outDir = await mkdtemp(join(tmpdir(), "reword-nerd-image-build-"));
    try {
      await build({ root: process.cwd(), base: "/reword-nerd/", build: { outDir, emptyOutDir: true } });
      const [textHtml, imageHtml] = await Promise.all([
        readFile(join(outDir, "index.html"), "utf8"),
        readFile(join(outDir, "image", "index.html"), "utf8"),
      ]);

      expect(textHtml).toContain("/reword-nerd/assets/");
      expect(imageHtml).toContain("/reword-nerd/assets/");
      expect(imageHtml).toContain('href="/reword-nerd/image/orange-pyramid.webp"');
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  }, 30_000);
});
