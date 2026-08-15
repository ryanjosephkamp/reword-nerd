import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, rename, rm, stat, statfs } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const MIB = 1024 * 1024;
const GIB = 1024n * 1024n * 1024n;
const FORMAT = Object.freeze({ width: 1280, height: 720, fps: 30, durationSeconds: 40 });
export const IMAGE_QUICK_START_MINIMUM_FREE_BYTES = 6n * GIB;

export const IMAGE_QUICK_START_BUDGETS = Object.freeze({
  webmBytes: Math.floor(1.8 * MIB),
  mp4Bytes: Math.floor(2.5 * MIB),
  posterBytes: 100 * 1024,
  aggregateBytes: Math.floor(4.4 * MIB),
});

function fail(message) {
  throw new Error(`Image Quick Start media check failed: ${message}`);
}

export async function assertImageVideoDiskFloor(rootDirectory, inspect = (path) => statfs(path, { bigint: true })) {
  const volume = await inspect(resolve(rootDirectory));
  const availableBytes = BigInt(volume.bavail) * BigInt(volume.bsize);
  if (availableBytes < IMAGE_QUICK_START_MINIMUM_FREE_BYTES) {
    fail(`rendering requires at least 6 GiB free; found ${(Number(availableBytes) / Number(GIB)).toFixed(2)} GiB`);
  }
  return availableBytes;
}

export function imageQuickStartMediaPaths() {
  return {
    mp4Path: "/reword-nerd/media/demo/image-overview.mp4",
    webmPath: "/reword-nerd/media/demo/image-overview.webm",
    posterPath: "/reword-nerd/media/demo/image-overview-poster.webp",
  };
}

function localPathForWebPath(rootDirectory, webPath) {
  if (typeof webPath !== "string" || !webPath.startsWith("/reword-nerd/") || webPath.includes("..") || /^(?:[a-z]+:)?\/\//iu.test(webPath)) fail(`unsafe same-origin path: ${webPath}`);
  const publicRoot = `${resolve(rootDirectory, "public")}${sep}`;
  const localPath = resolve(rootDirectory, "public", webPath.slice("/reword-nerd/".length));
  if (!localPath.startsWith(publicRoot)) fail(`unsafe local media path: ${webPath}`);
  return localPath;
}

function localFiles(rootDirectory) {
  return Object.fromEntries(Object.entries(imageQuickStartMediaPaths()).map(([key, path]) => [key, localPathForWebPath(rootDirectory, path)]));
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
  return {
    bytes: file.size,
    codec: video.codec_name,
    width: video.width,
    height: video.height,
    fps: roundedFps(video.avg_frame_rate),
    durationSeconds: Number(metadata.format?.duration),
    audioStreams: streams.filter((stream) => stream.codec_type === "audio").length,
  };
}

async function inspectPoster(path) {
  const [metadata, file] = await Promise.all([probe(path), stat(path)]);
  const video = metadata.streams?.find((stream) => stream.codec_type === "video");
  if (!video) fail(`${path} has no image stream`);
  const metadataTags = Object.keys(metadata.format?.tags ?? {}).filter((key) => key.toLowerCase() !== "encoder");
  return { bytes: file.size, codec: video.codec_name, width: video.width, height: video.height, metadataTags };
}

function verifyVideo(label, inspection, budget, expectedCodec) {
  if (inspection.codec !== expectedCodec) fail(`${label} codec must be ${expectedCodec}, got ${inspection.codec}`);
  if (inspection.width !== FORMAT.width || inspection.height !== FORMAT.height) fail(`${label} dimensions must be ${FORMAT.width}x${FORMAT.height}`);
  if (Math.abs(inspection.fps - FORMAT.fps) > 0.001) fail(`${label} framerate must be ${FORMAT.fps}`);
  if (!Number.isFinite(inspection.durationSeconds) || Math.abs(inspection.durationSeconds - FORMAT.durationSeconds) > 0.1) fail(`${label} duration must be ${FORMAT.durationSeconds} seconds`);
  if (inspection.audioStreams !== 0) fail(`${label} must not contain audio`);
  if (inspection.bytes > budget) fail(`${label} exceeds its ${budget}-byte budget`);
}

async function checkFiles(files) {
  await Promise.all(Object.values(files).map((path) => access(path)));
  const [mp4, webm, poster] = await Promise.all([inspectVideo(files.mp4Path), inspectVideo(files.webmPath), inspectPoster(files.posterPath)]);
  verifyVideo("MP4", mp4, IMAGE_QUICK_START_BUDGETS.mp4Bytes, "h264");
  verifyVideo("WebM", webm, IMAGE_QUICK_START_BUDGETS.webmBytes, "vp9");
  if (poster.codec !== "webp") fail(`poster codec must be webp, got ${poster.codec}`);
  if (poster.width !== FORMAT.width || poster.height !== FORMAT.height) fail(`poster dimensions must be ${FORMAT.width}x${FORMAT.height}`);
  if (poster.metadataTags.length > 0) fail(`poster must be metadata-free; found ${poster.metadataTags.join(", ")}`);
  if (poster.bytes > IMAGE_QUICK_START_BUDGETS.posterBytes) fail(`poster exceeds its ${IMAGE_QUICK_START_BUDGETS.posterBytes}-byte budget`);
  const aggregateBytes = mp4.bytes + webm.bytes + poster.bytes;
  if (aggregateBytes > IMAGE_QUICK_START_BUDGETS.aggregateBytes) fail(`media exceeds its ${IMAGE_QUICK_START_BUDGETS.aggregateBytes}-byte aggregate budget`);
  return { mp4, webm, poster, aggregateBytes };
}

export async function checkImageQuickStartMedia(rootDirectory) {
  return { paths: imageQuickStartMediaPaths(), ...await checkFiles(localFiles(rootDirectory)) };
}

async function pathExists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function publishCandidate(candidateDirectory, targetDirectory) {
  const candidate = resolve(candidateDirectory);
  const target = resolve(targetDirectory);
  const filenames = ["image-overview.mp4", "image-overview.webm", "image-overview-poster.webp"];
  const filesFor = (directory) => ({
    mp4Path: join(directory, filenames[0]),
    webmPath: join(directory, filenames[1]),
    posterPath: join(directory, filenames[2]),
  });
  await checkFiles(filesFor(candidate));
  await mkdir(target, { recursive: true });
  const backup = join(dirname(target), `.${basename(target)}-image-quick-start-previous-${randomUUID()}`);
  await mkdir(backup, { recursive: true });
  const movedPrior = [];
  const movedCandidate = [];
  try {
    for (const filename of filenames) {
      const prior = join(target, filename);
      if (await pathExists(prior)) {
        await rename(prior, join(backup, filename));
        movedPrior.push(filename);
      }
    }
    for (const filename of filenames) {
      await rename(join(candidate, filename), join(target, filename));
      movedCandidate.push(filename);
    }
    await checkFiles(filesFor(target));
  } catch (error) {
    for (const filename of movedCandidate.toReversed()) {
      const published = join(target, filename);
      if (await pathExists(published)) await rename(published, join(candidate, filename));
    }
    for (const filename of movedPrior.toReversed()) {
      await rename(join(backup, filename), join(target, filename));
    }
    throw error;
  }
  await rm(backup, { recursive: true, force: true });
}

export async function renderImageQuickStartMedia(rootDirectory) {
  const root = resolve(rootDirectory);
  await assertImageVideoDiskFloor(root);
  const paths = localFiles(root);
  const targetDirectory = dirname(paths.mp4Path);
  await mkdir(dirname(targetDirectory), { recursive: true });
  const temporary = await mkdtemp(join(dirname(targetDirectory), ".image-quick-start-staged-"));
  try {
    const sourceMp4 = join(temporary, "source.mp4");
    const mp4 = join(temporary, "image-overview.mp4");
    const webm = join(temporary, "image-overview.webm");
    const poster = join(temporary, "image-overview-poster.webp");
    const remotion = join(root, "node_modules", ".bin", "remotion");
    await execFile(remotion, ["render", "video/remotion/index.ts", "ImageQuickStart", sourceMp4, "--codec=h264", "--crf=32", "--concurrency=2", "--log=error"], { cwd: root, encoding: "utf8" });
    await execFile("ffmpeg", ["-y", "-i", sourceMp4, "-map_metadata", "-1", "-map_chapters", "-1", "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "32", "-movflags", "+faststart", mp4], { encoding: "utf8" });
    await execFile("ffmpeg", ["-y", "-i", sourceMp4, "-map_metadata", "-1", "-map_chapters", "-1", "-an", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "48", "-row-mt", "1", webm], { encoding: "utf8" });
    await execFile("ffmpeg", ["-y", "-ss", "00:00:18", "-i", sourceMp4, "-frames:v", "1", "-map_metadata", "-1", "-c:v", "libwebp", "-q:v", "64", poster], { encoding: "utf8" });
    await rm(sourceMp4, { force: true });
    await publishCandidate(temporary, targetDirectory);
    return checkImageQuickStartMedia(root);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
