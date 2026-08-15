import languageSource from "@tesseract.js-data/eng/4.0.0/eng.traineddata.gz?url";
import coreSource from "tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url";
import workerSource from "tesseract.js/dist/worker.min.js?url";
import { createWorker as createTesseractWorker, OEM } from "tesseract.js";

import {
  ImageIntakeFailure,
  imageIntakeIssue,
} from "./intakeContracts";
import { isImageOcrTextWithinLimit, MAX_IMAGE_OCR_TEXT_LENGTH } from "./contracts";

export const MAX_IMAGE_OCR_CODE_POINTS = MAX_IMAGE_OCR_TEXT_LENGTH;

export interface ImageOcrToken {
  readonly sessionGeneration: number;
  readonly itemId: string;
  readonly itemIncarnation: number;
  readonly sourceHash: string;
  readonly ocrGeneration: number;
}

export interface ImageOcrJob {
  readonly token: ImageOcrToken;
  readonly sourceBytes: Blob;
}

export interface ImageOcrResult {
  readonly token: ImageOcrToken;
  readonly detectedText: string;
}

export interface ImageOcrWorker {
  recognize(source: Blob): Promise<string>;
  terminate(): Promise<unknown>;
}

export interface ImageOcrService {
  recognize(job: ImageOcrJob): Promise<ImageOcrResult>;
  cancelItem(itemId: string, sourceHash?: string): Promise<void>;
  reset(): Promise<void>;
  dispose(): Promise<void>;
}

interface PendingJob {
  readonly job: ImageOcrJob;
  readonly epoch: number;
  readonly cancelledPromise: Promise<void>;
  cancel(): void;
  resolve(value: ImageOcrResult): void;
  reject(reason: unknown): void;
  cancelled: boolean;
  settled: boolean;
}

export interface ImageOcrServiceOptions {
  readonly createWorker?: () => Promise<ImageOcrWorker>;
  readonly isCurrent: (token: ImageOcrToken) => boolean;
}

function abortError(): DOMException {
  return new DOMException("OCR cancelled.", "AbortError");
}

function staleFailure(): ImageIntakeFailure {
  return new ImageIntakeFailure(imageIntakeIssue("STALE_SESSION"));
}

function ocrFailure(): ImageIntakeFailure {
  return new ImageIntakeFailure(imageIntakeIssue("OCR_FAILED"));
}

function parentUrl(url: string): string {
  return url.slice(0, url.lastIndexOf("/"));
}

async function createBrowserOcrWorker(): Promise<ImageOcrWorker> {
  const worker = await createTesseractWorker("eng", OEM.LSTM_ONLY, {
    workerPath: workerSource,
    corePath: coreSource,
    langPath: parentUrl(languageSource),
    cacheMethod: "none",
  });
  return {
    recognize: async (source) => (await worker.recognize(source)).data.text,
    terminate: async () => worker.terminate(),
  };
}

export function createImageOcrService(options: ImageOcrServiceOptions): ImageOcrService {
  const createWorker = options.createWorker ?? createBrowserOcrWorker;
  const queue: PendingJob[] = [];
  let active: PendingJob | null = null;
  let worker: ImageOcrWorker | null = null;
  let workerPromise: Promise<ImageOcrWorker> | null = null;
  let workerRetirement: Promise<void> = Promise.resolve();
  let pumpPromise: Promise<void> | null = null;
  let epoch = 0;
  let disposed = false;

  const settleReject = (pending: PendingJob, reason: unknown) => {
    if (pending.settled) return;
    pending.settled = true;
    pending.reject(reason);
  };

  const getWorker = async (pending: PendingJob): Promise<ImageOcrWorker> => {
    await workerRetirement;
    if (pending.cancelled || pending.epoch !== epoch || disposed) throw abortError();
    if (worker) return worker;
    workerPromise ??= createWorker().then((created) => {
      worker = created;
      return created;
    });
    try {
      return await workerPromise;
    } finally {
      workerPromise = null;
    }
  };

  const terminateWorker = () => {
    const creating = workerPromise;
    const current = worker;
    worker = null;
    workerPromise = null;
    const retirement = workerRetirement.then(async () => {
      if (current) {
        await current.terminate();
        return;
      }
      if (creating) {
        try {
          const created = await creating;
          if (worker === created) worker = null;
          await created.terminate();
        } catch {
          // A failed worker creation owns no reusable OCR resource.
        }
      }
    });
    workerRetirement = retirement.catch(() => undefined);
    return retirement;
  };

  const runQueue = async () => {
    while (queue.length > 0) {
      const pending = queue.shift()!;
      if (pending.cancelled || pending.epoch !== epoch || disposed) {
        settleReject(pending, abortError());
        continue;
      }
      if (!options.isCurrent(pending.job.token)) {
        settleReject(pending, staleFailure());
        continue;
      }
      active = pending;
      try {
        const currentWorker = await getWorker(pending);
        if (pending.cancelled || pending.epoch !== epoch || disposed) throw abortError();
        const detectedText = await Promise.race([
          currentWorker.recognize(pending.job.sourceBytes),
          pending.cancelledPromise.then(() => { throw abortError(); }),
        ]);
        if (pending.cancelled || pending.epoch !== epoch || disposed) throw abortError();
        if (!options.isCurrent(pending.job.token)) throw staleFailure();
        if (!isImageOcrTextWithinLimit(detectedText)) {
          throw new ImageIntakeFailure(imageIntakeIssue("OCR_TEXT_LIMIT_EXCEEDED"));
        }
        if (!pending.settled) {
          pending.settled = true;
          pending.resolve(Object.freeze({ token: pending.job.token, detectedText }));
        }
      } catch (error) {
        if (pending.cancelled || pending.epoch !== epoch || disposed) {
          settleReject(pending, abortError());
        } else if (error instanceof ImageIntakeFailure || (error instanceof DOMException && error.name === "AbortError")) {
          settleReject(pending, error);
        } else {
          settleReject(pending, ocrFailure());
        }
      } finally {
        if (active === pending) active = null;
      }
    }
  };

  const ensurePump = () => {
    if (pumpPromise) return;
    pumpPromise = runQueue().finally(() => {
      pumpPromise = null;
      if (queue.length > 0) ensurePump();
    });
  };

  const cancelMatching = async (predicate: (pending: PendingJob) => boolean) => {
    let cancelledActive = false;
    for (const pending of queue) {
      if (!predicate(pending)) continue;
      pending.cancelled = true;
      settleReject(pending, abortError());
    }
    if (active && predicate(active)) {
      active.cancelled = true;
      active.cancel();
      settleReject(active, abortError());
      cancelledActive = true;
    }
    if (cancelledActive) await terminateWorker();
  };

  return {
    recognize: (job) => {
      if (disposed) return Promise.reject(abortError());
      if (!options.isCurrent(job.token)) return Promise.reject(staleFailure());
      const ownedJob = Object.freeze({
        token: Object.freeze({ ...job.token }),
        sourceBytes: job.sourceBytes,
      });
      return new Promise<ImageOcrResult>((resolve, reject) => {
        let cancel!: () => void;
        const cancelledPromise = new Promise<void>((resolveCancel) => { cancel = resolveCancel; });
        queue.push({
          job: ownedJob,
          epoch,
          cancelledPromise,
          cancel,
          resolve,
          reject,
          cancelled: false,
          settled: false,
        });
        ensurePump();
      });
    },
    cancelItem: async (itemId, sourceHash) => {
      await cancelMatching(({ job }) => job.token.itemId === itemId
        && (sourceHash === undefined || job.token.sourceHash === sourceHash));
    },
    reset: async () => {
      epoch += 1;
      await cancelMatching(() => true);
      await terminateWorker();
    },
    dispose: async () => {
      disposed = true;
      epoch += 1;
      await cancelMatching(() => true);
      await terminateWorker();
    },
  };
}
