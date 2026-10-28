// Records the demo shown on the site and at the top of the README: the real app, driven by a
// script, with the agent's run shown as a labeled simulation. Needs a build (npm run build) and
// ffmpeg and cwebp. Writes public/media/demo.mp4, demo.webm, demo-poster.webp, and demo.gif.
// Run with: node scripts/demo/record.mjs
import { spawn, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { originalDocx, REPORT, rewrittenDocx } from "./rewrite.mjs";

const root = resolve(import.meta.dirname, "../..");
const media = join(root, "public/media");
const port = 4179;
const WIDTH = 1280;
const HEIGHT = 800;

const work = await mkdtemp(join(tmpdir(), "rn-demo-"));
const frames = join(work, "frames");
await mkdir(frames, { recursive: true });
await mkdir(media, { recursive: true });

// The document to rewrite, and the finished task folder the "agent" hands back.
const source = join(work, "garden-proposal.docx");
await writeFile(source, await originalDocx());
const result = join(work, "result", "rn-garden-proposal");
await mkdir(join(result, "output"), { recursive: true });
await writeFile(join(result, "output", "garden-proposal.docx"), await rewrittenDocx());
await writeFile(join(result, "REPORT.md"), REPORT);

const server = spawn("npx", ["vite", "preview", "--port", String(port), "--strictPort"], {
  cwd: root,
  stdio: "ignore",
});
await new Promise((resolveWait) => setTimeout(resolveWait, 2500));

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 1,
  colorScheme: "dark",
  acceptDownloads: true,
});
await context.grantPermissions(["clipboard-read", "clipboard-write"], {
  origin: `http://localhost:${port}`,
});
await context.addInitScript({ path: join(import.meta.dirname, "stage.js") });
const page = await context.newPage();

// Capture every painted frame with its time, for a smooth, sharp video.
const cdp = await context.newCDPSession(page);
const captured = [];
cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
  const file = join(frames, `${String(captured.length).padStart(5, "0")}.jpg`);
  captured.push({ file, time: metadata.timestamp });
  await writeFile(file, Buffer.from(data, "base64"));
  await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});

const pause = (ms) => page.waitForTimeout(ms);
let mouse = { x: WIDTH - 120, y: HEIGHT - 80 };

async function moveTo(x, y, ms = 650) {
  const steps = Math.max(8, Math.round(ms / 16));
  const from = { ...mouse };
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const ease = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    await page.mouse.move(from.x + (x - from.x) * ease, from.y + (y - from.y) * ease);
    await pause(ms / steps);
  }
  mouse = { x, y };
}

async function point(locator, ms) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  await moveTo(box.x + box.width / 2, box.y + box.height / 2, ms);
}

// A real click where the cursor is, so the page sees exactly what a person would do.
async function click(locator, ms) {
  await point(locator, ms);
  await pause(120);
  await page.mouse.down();
  await pause(60);
  await page.mouse.up();
}

try {
  await page.goto(`http://localhost:${port}/app/?mode=text`);
  await page.getByRole("button", { name: "Try a sample document" }).waitFor();
  await page.mouse.move(mouse.x, mouse.y);
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });
  await pause(900);

  // A Word file is dropped on the page.
  await page.evaluate(
    ([x, y]) => window.__demo.chip("garden-proposal.docx", "file", x, y),
    [mouse.x, mouse.y],
  );
  await moveTo(640, 430, 1100);
  await page.evaluate(() => window.__demo.dropChip());
  await page.locator('input[type="file"][multiple]').first().setInputFiles(source);
  await page.getByRole("heading", { name: "garden-proposal.docx" }).waitFor();
  await pause(1400);

  // Choose a goal and hand it to a coding agent.
  await click(page.locator(".goal-card", { hasText: "Polish it" }), 800);
  await pause(700);
  const download = page.waitForEvent("download");
  const downloadButton = page.getByRole("button", { name: "Download task folder" });
  await click(downloadButton, 700);
  await download;
  await pause(600);
  const copy = page.getByRole("button", { name: "Copy command" });
  await click(copy, 600);
  await pause(700);
  const command = (await page.locator(".command code").textContent()).trim();

  // The agent's run, shown as a simulation.
  await page.evaluate(() => window.__demo.openTerminal());
  await page.evaluate((text) => window.__demo.type(text), command);
  await page.evaluate(() =>
    window.__demo.lines([
      ["Reading TASK.md and source/garden-proposal.docx", 500],
      ["1/4  Decompose  listed 31 points the rewrite must keep", 900, "done"],
      ["2/4  Rewrite    new wording and structure, same meaning", 1000, "done"],
      ["3/4  Verify     nothing lost, added, or changed", 900, "done"],
      ["4/4  Final      wrote output/garden-proposal.docx", 800, "done"],
      ["Wrote REPORT.md. Finished.", 500],
    ]),
  );
  await pause(1300);

  // Bring the finished folder back.
  await page.evaluate(() => window.__demo.closeTerminal());
  const bringBack = page.locator("summary", { hasText: "Bring the result back" });
  await click(bringBack, 700);
  await pause(500);
  const target = page.locator(".drop-target");
  await target.scrollIntoViewIfNeeded();
  await page.evaluate(
    ([x, y]) => window.__demo.chip("rn-garden-proposal", "folder", x, y),
    [mouse.x, mouse.y],
  );
  await point(target, 900);
  await page.evaluate(() => window.__demo.dropChip());
  await page
    .locator('.drop-target input[type="file"][webkitdirectory]')
    .setInputFiles(join(work, "result"));
  await page.getByRole("heading", { name: "The rewrite", exact: true }).waitFor();
  await pause(2600);

  // Review the changes, GitHub style, then download.
  const changes = page.getByRole("radio", { name: "Changes", exact: true });
  await click(changes, 700);
  await page.locator(".diff-table").waitFor();
  await pause(1500);
  await moveTo(640, 520, 500);
  for (let step = 0; step < 8; step += 1) {
    await page.mouse.wheel(0, 70);
    await pause(90);
  }
  await pause(1600);
  const downloadMenu = page.getByRole("button", { name: "Download", exact: true });
  await click(downloadMenu, 700);
  await page.evaluate(() => window.__demo.raise());
  await pause(500);
  const word = page.getByRole("dialog", { name: "Download" }).getByRole("button", {
    name: /^Word document/,
  });
  await point(word, 500);
  await pause(900);
  await cdp.send("Page.stopScreencast");
} finally {
  await browser.close();
  server.kill();
}

// Turn the timed frames into a constant-rate video, then a GIF for the README.
const list = captured
  .map((frame, index) => {
    const next = captured[index + 1]?.time ?? frame.time + 0.5;
    return `file '${frame.file}'\nduration ${Math.max(0.001, next - frame.time).toFixed(4)}`;
  })
  .join("\n");
await writeFile(join(work, "frames.txt"), `${list}\nfile '${captured.at(-1).file}'\n`);
const ffmpeg = (args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args]);
const master = join(work, "master.mp4");
ffmpeg([
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  join(work, "frames.txt"),
  "-fps_mode",
  "cfr",
  "-r",
  "30",
  "-c:v",
  "libx264",
  "-crf",
  "12",
  "-pix_fmt",
  "yuv420p",
  master,
]);
ffmpeg([
  "-i",
  master,
  "-c:v",
  "libx264",
  "-crf",
  "24",
  "-preset",
  "slow",
  "-pix_fmt",
  "yuv420p",
  "-movflags",
  "+faststart",
  "-an",
  join(media, "demo.mp4"),
]);
ffmpeg([
  "-i",
  master,
  "-c:v",
  "libvpx-vp9",
  "-crf",
  "36",
  "-b:v",
  "0",
  "-an",
  join(media, "demo.webm"),
]);
const poster = join(work, "poster.png");
ffmpeg(["-sseof", "-4", "-i", master, "-frames:v", "1", poster]);
execFileSync("cwebp", ["-quiet", "-q", "82", poster, "-o", join(media, "demo-poster.webp")]);
ffmpeg([
  "-i",
  master,
  "-vf",
  "fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle",
  join(media, "demo.gif"),
]);
await rm(work, { recursive: true, force: true });
const sizes = await Promise.all(
  ["demo.mp4", "demo.webm", "demo-poster.webp", "demo.gif"].map(
    async (name) => `${name} ${Math.round((await stat(join(media, name))).size / 1024)} KB`,
  ),
);
console.log(`Recorded ${captured.length} frames.\n${sizes.join("\n")}`);
