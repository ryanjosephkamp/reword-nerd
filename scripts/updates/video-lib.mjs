import { access, mkdir, mkdtemp, open, rename, rm, stat, writeFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { basename, dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const execFile = promisify(execFileCallback);
const MIB = 1024 * 1024;

export const RELEASE_VIDEO_BUDGETS = Object.freeze({
  webmBytes: Math.floor(1.5 * MIB),
  mp4Bytes: 2 * MIB,
  posterBytes: 100 * 1024,
  transcriptBytes: 256 * 1024,
  aggregateBytes: Math.floor(3.5 * MIB),
});

const RELEASE_FORMAT = Object.freeze({ width: 1280, height: 720, fps: 30 });
const SUPPORTED_VERSION = "0.7.0";

function fail(message) {
  throw new Error(`Release media check failed: ${message}`);
}

function releaseSlug(version) {
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/u.test(version)) throw new Error(`Invalid release version: ${version}`);
  return `v${version.replaceAll(".", "-")}`;
}

export function releaseMediaPaths(version) {
  const root = `/reword-nerd/media/updates/${releaseSlug(version)}`;
  return {
    mp4Path: `${root}/release-update.mp4`,
    webmPath: `${root}/release-update.webm`,
    posterPath: `${root}/poster.webp`,
    transcriptPath: `${root}/transcript.txt`,
  };
}

function localPathForWebPath(rootDirectory, webPath) {
  if (typeof webPath !== "string" || !webPath.startsWith("/reword-nerd/") || webPath.includes("..") || /^(?:[a-z]+:)?\/\//iu.test(webPath)) fail(`unsafe same-origin path: ${webPath}`);
  const publicRoot = resolve(rootDirectory, "public") + sep;
  const localPath = resolve(rootDirectory, "public", webPath.slice("/reword-nerd/".length));
  if (!localPath.startsWith(publicRoot)) fail(`unsafe local media path: ${webPath}`);
  return localPath;
}

async function probe(path) {
  const { stdout } = await execFile("ffprobe", ["-v", "error", "-show_entries", "format=duration:format_tags:stream=codec_name,codec_type,width,height,avg_frame_rate", "-of", "json", path], { encoding: "utf8" });
  return JSON.parse(stdout);
}

function roundedFps(value) {
  if (typeof value !== "string" || !/^\d+\/\d+$/u.test(value)) return Number.NaN;
  const [numerator, denominator] = value.split("/").map(Number);
  return denominator === 0 ? Number.NaN : numerator / denominator;
}

async function inspectVideo(path) {
  const [metadata, file] = await Promise.all([probe(path), stat(path)]);
  const streams = Array.isArray(metadata.streams) ? metadata.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  if (!video) fail(`${path} has no video stream`);
  return { bytes: file.size, codec: video.codec_name, width: video.width, height: video.height, fps: roundedFps(video.avg_frame_rate), durationSeconds: Number(metadata.format?.duration), audioStreams: streams.filter((stream) => stream.codec_type === "audio").length };
}

async function inspectPoster(path) {
  const [metadata, file] = await Promise.all([probe(path), stat(path)]);
  const video = metadata.streams?.find((stream) => stream.codec_type === "video");
  if (!video) fail(`${path} has no image stream`);
  const tags = Object.keys(metadata.format?.tags ?? {}).filter((key) => !["encoder"].includes(key.toLowerCase()));
  return { bytes: file.size, codec: video.codec_name, width: video.width, height: video.height, metadataTags: tags };
}

function verifyVideo(label, inspection, budget, expectedCodec) {
  if (inspection.codec !== expectedCodec) fail(`${label} codec must be ${expectedCodec}, got ${inspection.codec}`);
  if (inspection.width !== RELEASE_FORMAT.width || inspection.height !== RELEASE_FORMAT.height) fail(`${label} dimensions must be ${RELEASE_FORMAT.width}x${RELEASE_FORMAT.height}`);
  if (Math.abs(inspection.fps - RELEASE_FORMAT.fps) > 0.001) fail(`${label} framerate must be ${RELEASE_FORMAT.fps}`);
  if (!Number.isFinite(inspection.durationSeconds) || inspection.durationSeconds < 20 || inspection.durationSeconds > 30) fail(`${label} duration must be between 20 and 30 seconds`);
  if (inspection.audioStreams !== 0) fail(`${label} must not contain audio`);
  if (inspection.bytes > budget) fail(`${label} exceeds its ${budget}-byte budget`);
}

function releaseTranscript(version) {
  return `reword-nerd v${version} — Updates, feedback, and Share\n\n00:00 — Title: Updates, feedback, and Share. A quiet, local-first release walkthrough.\n00:05 — Context: Release context should be easy to find. The release ledger records version, current status, same-origin media, and the local-first privacy boundary.\n00:09 — Demonstration: The Updates archive shows the current v0.7 release and Road to v0.6. The synthetic interface highlights Report a bug, Suggest a feature, and Share release.\n00:16 — Highlights: Static Updates pages with RSS. Clear bug and feature routes. Canonical Share with no tracking.\n00:20 — Feedback: Find the release. Send useful feedback. Share the clean URL. Built in public. Processed locally.\n`;
}

function releaseMediaFiles(directory) {
  return {
    mp4Path: join(directory, "release-update.mp4"),
    webmPath: join(directory, "release-update.webm"),
    posterPath: join(directory, "poster.webp"),
    transcriptPath: join(directory, "transcript.txt"),
  };
}

async function readBoundedTranscript(path) {
  const handle = await open(path, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile()) fail("transcript must be a regular file");
    if (before.size > RELEASE_VIDEO_BUDGETS.transcriptBytes) fail(`transcript exceeds its ${RELEASE_VIDEO_BUDGETS.transcriptBytes}-byte budget`);
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) fail("transcript changed while it was being read");
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== before.size) fail("transcript changed while it was being read");
    return { content: bytes.toString("utf8"), bytes: bytes.length };
  } finally {
    await handle.close();
  }
}

async function checkReleaseMediaFiles(files, version) {
  await Promise.all(Object.values(files).map((path) => access(path)));
  const transcript = await readBoundedTranscript(files.transcriptPath);
  const [mp4, webm, poster] = await Promise.all([inspectVideo(files.mp4Path), inspectVideo(files.webmPath), inspectPoster(files.posterPath)]);
  verifyVideo("MP4", mp4, RELEASE_VIDEO_BUDGETS.mp4Bytes, "h264");
  verifyVideo("WebM", webm, RELEASE_VIDEO_BUDGETS.webmBytes, "vp9");
  if (poster.codec !== "webp") fail(`poster codec must be webp, got ${poster.codec}`);
  if (poster.width !== RELEASE_FORMAT.width || poster.height !== RELEASE_FORMAT.height) fail(`poster dimensions must be ${RELEASE_FORMAT.width}x${RELEASE_FORMAT.height}`);
  if (poster.metadataTags.length > 0) fail(`poster must be metadata-free; found ${poster.metadataTags.join(", ")}`);
  if (poster.bytes > RELEASE_VIDEO_BUDGETS.posterBytes) fail(`poster exceeds its ${RELEASE_VIDEO_BUDGETS.posterBytes}-byte budget`);
  if (!transcript.content.includes(`reword-nerd v${version}`) || !transcript.content.includes("Share the clean URL")) fail("transcript is missing the release walkthrough");
  const aggregateBytes = mp4.bytes + webm.bytes + poster.bytes + transcript.bytes;
  if (aggregateBytes > RELEASE_VIDEO_BUDGETS.aggregateBytes) fail(`release media exceeds its ${RELEASE_VIDEO_BUDGETS.aggregateBytes}-byte aggregate budget`);
  return { mp4, webm, poster, transcriptBytes: transcript.bytes, aggregateBytes };
}

async function validateVersionAssets(rootDirectory, version) {
  if (version !== SUPPORTED_VERSION) throw new Error(`No deterministic ReleaseUpdate composition is configured for ${version}`);
  const paths = releaseMediaPaths(version);
  const files = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, localPathForWebPath(rootDirectory, path)]));
  return { paths, files };
}

export async function checkReleaseMedia(rootDirectory, version) {
  const { paths, files } = await validateVersionAssets(rootDirectory, version);
  return { paths, ...await checkReleaseMediaFiles(files, version) };
}

export async function checkReleaseMediaDirectory(directory, version) {
  return checkReleaseMediaFiles(releaseMediaFiles(directory), version);
}

async function pathExists(path) {
  try { await access(path); return true; } catch { return false; }
}

export async function publishReleaseMediaCandidate(candidateDirectory, targetDirectory, version, check = checkReleaseMediaDirectory) {
  const candidate = resolve(candidateDirectory);
  const target = resolve(targetDirectory);
  await check(candidate, version);
  const backup = join(dirname(target), `.${basename(target)}-previous-${randomUUID()}`);
  const priorExists = await pathExists(target);
  let priorMoved = false;
  let candidateMoved = false;
  try {
    if (priorExists) { await rename(target, backup); priorMoved = true; }
    await rename(candidate, target);
    candidateMoved = true;
    await check(target, version);
  } catch (error) {
    try {
      if (candidateMoved && await pathExists(target)) await rename(target, candidate);
      if (priorMoved) await rename(backup, target);
    } catch (rollbackError) {
      const publicationError = error instanceof Error ? error.message : String(error);
      throw new Error(`Release media publication failed and rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}. Original publication error: ${publicationError}`, { cause: rollbackError });
    }
    throw error;
  }
  if (priorMoved) await rm(backup, { recursive: true, force: true });
}

export async function renderReleaseMedia(rootDirectory, version) {
  if (version !== SUPPORTED_VERSION) throw new Error(`No deterministic ReleaseUpdate composition is configured for ${version}`);
  const root = resolve(rootDirectory);
  const paths = releaseMediaPaths(version);
  const output = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, localPathForWebPath(root, path)]));
  const targetDirectory = dirname(output.mp4Path);
  await mkdir(dirname(targetDirectory), { recursive: true });
  const temporary = await mkdtemp(join(dirname(targetDirectory), ".v0-7-0-staged-"));
  try {
    const sourceMp4 = join(temporary, "source.mp4");
    const { mp4Path: mp4, webmPath: webm, posterPath: poster, transcriptPath } = releaseMediaFiles(temporary);
    await execFile("npx", ["remotion", "render", "video/remotion/index.ts", "ReleaseUpdate", sourceMp4, "--codec=h264", "--crf=32", "--concurrency=2", "--log=error"], { cwd: root, encoding: "utf8" });
    await execFile("ffmpeg", ["-y", "-i", sourceMp4, "-map_metadata", "-1", "-map_chapters", "-1", "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "32", "-movflags", "+faststart", mp4], { encoding: "utf8" });
    await execFile("ffmpeg", ["-y", "-i", sourceMp4, "-map_metadata", "-1", "-map_chapters", "-1", "-an", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "47", "-row-mt", "1", webm], { encoding: "utf8" });
    await execFile("ffmpeg", ["-y", "-ss", "00:00:12", "-i", sourceMp4, "-frames:v", "1", "-map_metadata", "-1", "-c:v", "libwebp", "-q:v", "62", poster], { encoding: "utf8" });
    await writeFile(transcriptPath, releaseTranscript(version), "utf8");
    await rm(sourceMp4, { force: true });
    await publishReleaseMediaCandidate(temporary, targetDirectory, version);
    return checkReleaseMedia(root, version);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
