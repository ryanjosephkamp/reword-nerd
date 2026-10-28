// Saves pdf.js pictures as PNG. A worker does the encoding when the browser supports it,
// because main-thread canvas encoding stalls about a second per picture in a background
// tab (see pngEncoder.worker.ts); otherwise a page canvas does.
import { toRgba, type PdfImageData } from "./pdfImages";

interface Job {
  resolve: (blob: Blob) => void;
  reject: (error: Error) => void;
}

interface EncodeReply {
  id: number;
  blob?: Blob;
  error?: string;
}

const IDLE_MS = 30_000;

let worker: Worker | undefined;
let workerFailed = false;
let nextId = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const jobs = new Map<number, Job>();

function stopWorker(reason: Error) {
  clearTimeout(idleTimer);
  worker?.terminate();
  worker = undefined;
  for (const job of jobs.values()) job.reject(reason);
  jobs.clear();
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
    jobs.delete(data.id);
    if (data.blob) job?.resolve(data.blob);
    else job?.reject(new Error(data.error ?? "Couldn't save the picture."));
    // Stop the idle worker, like the OCR worker, so nothing lingers between imports.
    if (jobs.size === 0) idleTimer = setTimeout(() => stopWorker(new Error("Stopped.")), IDLE_MS);
  };
  worker.onerror = () => {
    workerFailed = true;
    stopWorker(new Error("The picture encoder couldn't start."));
  };
  return worker;
}

async function encodeInWorker(target: Worker, image: PdfImageData): Promise<Blob> {
  // pdf.js may draw its bitmap again (in a page capture, or on a later page), so the worker
  // gets a copy to own and close.
  const bitmap = image.bitmap ? await createImageBitmap(image.bitmap) : undefined;
  const rgba = bitmap ? undefined : toRgba(image);
  const transfer: Transferable[] = bitmap ? [bitmap] : rgba ? [rgba.buffer] : [];
  nextId += 1;
  const id = nextId;
  return new Promise((resolve, reject) => {
    jobs.set(id, { resolve, reject });
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
  const target = encoderWorker();
  if (target) {
    try {
      return await encodeInWorker(target, image);
    } catch (error) {
      // Only a worker that never started falls back; a picture that fails to encode fails.
      if (!workerFailed) throw error;
    }
  }
  return encodeOnMainThread(image);
}
