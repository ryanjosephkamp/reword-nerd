// Saves pdf.js pictures as PNG. A worker does the encoding when the browser supports it,
// because main-thread canvas encoding stalls about a second per picture in a background
// tab (see pngEncoder.worker.ts); otherwise a page canvas does.
import { toRgba, type PdfImageData } from "./pdfImages";

interface Job {
  resolve: (blob: Blob) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface EncodeReply {
  id: number;
  blob?: Blob;
  error?: string;
}

const IDLE_MS = 30_000;
/** A picture the worker hasn't saved by then isn't coming; the worker is restarted. */
export const ENCODE_TIMEOUT_MS = 60_000;

let worker: Worker | undefined;
let workerFailed = false;
let nextId = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const jobs = new Map<number, Job>();

function stopWorker(reason: Error) {
  clearTimeout(idleTimer);
  worker?.terminate();
  worker = undefined;
  for (const job of jobs.values()) {
    clearTimeout(job.timer);
    job.reject(reason);
  }
  jobs.clear();
}

function scheduleIdleStop() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    // A job started since the timer was set keeps the worker running.
    if (jobs.size === 0) stopWorker(new Error("Stopped."));
  }, IDLE_MS);
}

function encoderWorker(): Worker | null {
  if (workerFailed || typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") {
    return null;
  }
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./pngEncoder.worker.ts", import.meta.url), { type: "module" });
  } catch {
    workerFailed = true;
    return null;
  }
  worker.onmessage = ({ data }: MessageEvent<EncodeReply>) => {
    const job = jobs.get(data.id);
    if (!job) return;
    jobs.delete(data.id);
    clearTimeout(job.timer);
    if (data.blob) job.resolve(data.blob);
    else job.reject(new Error(data.error ?? "Couldn't save the picture."));
    // Stop the idle worker, like the OCR worker, so nothing lingers between imports.
    if (jobs.size === 0) scheduleIdleStop();
  };
  worker.onerror = () => {
    workerFailed = true;
    stopWorker(new Error("The picture encoder couldn't start."));
  };
  return worker;
}

async function encodeInWorker(image: PdfImageData): Promise<Blob> {
  // pdf.js may draw its bitmap again (in a page capture, or on a later page), so the worker
  // gets a copy to own and close.
  const bitmap = image.bitmap ? await createImageBitmap(image.bitmap) : undefined;
  const rgba = bitmap ? undefined : toRgba(image);
  const transfer: Transferable[] = bitmap ? [bitmap] : rgba ? [rgba.buffer] : [];
  // Asked for again after the wait above, in case the worker was stopped meanwhile.
  const target = encoderWorker();
  if (!target) throw new Error("The picture encoder couldn't start.");
  nextId += 1;
  const id = nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => stopWorker(new Error("Saving the picture took too long.")),
      ENCODE_TIMEOUT_MS,
    );
    jobs.set(id, { resolve, reject, timer });
    clearTimeout(idleTimer);
    target.postMessage({ id, width: image.width, height: image.height, bitmap, rgba }, transfer);
  });
}

async function encodeOnMainThread(image: PdfImageData): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser can't draw pictures.");
    if (image.bitmap) context.drawImage(image.bitmap, 0, 0);
    else context.putImageData(new ImageData(toRgba(image), image.width, image.height), 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Couldn't save the picture."))),
        "image/png",
      ),
    );
  } finally {
    // Releases the canvas memory right away; Safari otherwise holds it until collection.
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function encodePdfImageAsPng(image: PdfImageData): Promise<Blob> {
  // Keeps the idle stop from ending the worker while this picture is being prepared.
  clearTimeout(idleTimer);
  if (encoderWorker()) {
    try {
      return await encodeInWorker(image);
    } catch (error) {
      if (worker && jobs.size === 0) scheduleIdleStop();
      // Only a worker that never started falls back; a picture that fails to encode fails.
      if (!workerFailed) throw error;
    }
  }
  return encodeOnMainThread(image);
}
