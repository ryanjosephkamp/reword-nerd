// Shared OCR: one Tesseract worker for the whole app, started on first use and stopped
// after a minute of inactivity so scanned files don't leave workers running.
import type { Worker } from "tesseract.js";

const IDLE_MS = 60_000;

let workerPromise: Promise<Worker> | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let queue: Promise<unknown> = Promise.resolve();

function parentUrl(url: string): string {
  return url.slice(0, url.lastIndexOf("/"));
}

async function createWorker(): Promise<Worker> {
  const [tesseract, language, core, worker] = await Promise.all([
    import("tesseract.js"),
    import("@tesseract.js-data/eng/4.0.0/eng.traineddata.gz?url"),
    import("tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url"),
    import("tesseract.js/dist/worker.min.js?url"),
  ]);
  return tesseract.createWorker("eng", tesseract.OEM.LSTM_ONLY, {
    workerPath: worker.default,
    corePath: core.default,
    langPath: parentUrl(language.default),
    cacheMethod: "none",
  });
}

function scheduleIdleStop() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void disposeOcr(), IDLE_MS);
}

export interface OcrResult {
  text: string;
  /** Tesseract's mean confidence, 0 to 100. */
  confidence: number;
}

/** Recognizes English text in an image. Calls run one at a time on the shared worker. */
export function recognizeText(image: Blob, signal?: AbortSignal): Promise<OcrResult> {
  const run = async (): Promise<OcrResult> => {
    signal?.throwIfAborted();
    clearTimeout(idleTimer);
    workerPromise ??= createWorker();
    const worker = await workerPromise;
    signal?.throwIfAborted();
    const result = await worker.recognize(image);
    signal?.throwIfAborted();
    return { text: result.data.text.trim(), confidence: result.data.confidence };
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined).finally(scheduleIdleStop);
  return next;
}

/** Stops the OCR worker now. The next recognizeText call starts a fresh one. */
export async function disposeOcr(): Promise<void> {
  clearTimeout(idleTimer);
  const active = workerPromise;
  workerPromise = undefined;
  if (active) await (await active).terminate();
}
