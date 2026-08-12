import languageSource from "@tesseract.js-data/eng/4.0.0/eng.traineddata.gz?url";
import coreSource from "tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url";
import workerSource from "tesseract.js/dist/worker.min.js?url";
import { createWorker, OEM, type Worker } from "tesseract.js";

import type { OcrAdapter } from "./extraction";

const TESSERACT_VERSION = "7.0.0";
const ENGLISH_LANGUAGE_SHA256 = "ed350f3752f81ee8f38769edc14d92d997dababe23b565c59879372cc46a2468";

function parentUrl(url: string): string {
  return url.slice(0, url.lastIndexOf("/"));
}

export async function loadBrowserOcrAdapter(): Promise<OcrAdapter> {
  let worker: Worker | undefined;
  let workerPromise: Promise<Worker> | undefined;
  let progressHandler: ((progress: number) => void) | undefined;
  const getWorker = () => {
    workerPromise ??= createWorker("eng", OEM.LSTM_ONLY, {
      workerPath: workerSource,
      corePath: coreSource,
      langPath: parentUrl(languageSource),
      cacheMethod: "none",
      logger: (message) => {
        if (message.status === "recognizing text" && typeof message.progress === "number") {
          progressHandler?.(message.progress);
        }
      },
    }).then((created) => {
      worker = created;
      return created;
    });
    return workerPromise;
  };

  const terminate = async () => {
    const active = worker;
    worker = undefined;
    workerPromise = undefined;
    progressHandler = undefined;
    await active?.terminate();
  };

  return {
    recognize: async (image, context) => {
      if (context.language.kind !== "bundled" || context.language.code !== "eng") {
        throw new Error("This release supports bundled English OCR only.");
      }
      if (context.signal?.aborted) throw new DOMException("OCR cancelled.", "AbortError");
      progressHandler = context.onProgress;
      const abort = () => { void terminate(); };
      context.signal?.addEventListener("abort", abort, { once: true });
      try {
        const active = await getWorker();
        const result = await active.recognize(new Blob([image.bytes.slice()], { type: "image/png" }));
        if (context.signal?.aborted) throw new DOMException("OCR cancelled.", "AbortError");
        return {
          text: result.data.text,
          confidence: result.data.confidence,
          engineVersion: TESSERACT_VERSION,
          languageHash: ENGLISH_LANGUAGE_SHA256,
        };
      } finally {
        context.signal?.removeEventListener("abort", abort);
        progressHandler = undefined;
      }
    },
    terminate,
  };
}
