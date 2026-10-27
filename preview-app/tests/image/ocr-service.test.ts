import { Blob as NativeBlob } from "node:buffer";

import {
  createImageOcrService,
  type ImageOcrJob,
  type ImageOcrWorker,
} from "../../src/image/ocrService";
import type { ImageIntakeFailure } from "../../src/image/intakeContracts";

function job(itemId: string, generation = 1, mimeType = "image/png"): ImageOcrJob {
  return {
    token: {
      sessionGeneration: 2,
      itemId,
      itemIncarnation: 3,
      sourceHash: `hash-${itemId}`,
      ocrGeneration: generation,
    },
    sourceBytes: new NativeBlob([new Uint8Array([itemId.length])], { type: mimeType }) as Blob,
  };
}

function issueCode(error: unknown): string | undefined {
  return (error as ImageIntakeFailure | undefined)?.issue?.code;
}

describe("Image OCR service", () => {
  it("is off/lazy by default and passes the exact owned Blob with its real MIME", async () => {
    // Catches intake eagerly creating OCR resources or converting every image to a fictitious PNG.
    let workerCreates = 0;
    const recognized: Blob[] = [];
    const service = createImageOcrService({
      createWorker: async () => {
        workerCreates += 1;
        return {
          recognize: async (source) => { recognized.push(source); return "VISIBLE"; },
          terminate: async () => undefined,
        };
      },
      isCurrent: () => true,
    });
    expect(workerCreates).toBe(0);
    const source = job("webp", 1, "image/webp");
    const result = await service.recognize(source);
    expect(workerCreates).toBe(1);
    expect(recognized).toEqual([source.sourceBytes]);
    expect(recognized[0].type).toBe("image/webp");
    expect(result).toEqual({ token: source.token, detectedText: "VISIBLE" });
    await service.dispose();
  });

  it("processes bulk jobs one at a time in queue order", async () => {
    // Catches parallel Tesseract jobs causing unbounded memory or nondeterministic OCR order.
    let active = 0;
    let maximum = 0;
    const order: string[] = [];
    const worker: ImageOcrWorker = {
      recognize: async (source) => {
        active += 1;
        maximum = Math.max(maximum, active);
        const value = String(new Uint8Array(await source.arrayBuffer())[0]);
        order.push(`start:${value}`);
        await Promise.resolve();
        order.push(`end:${value}`);
        active -= 1;
        return value;
      },
      terminate: async () => undefined,
    };
    const service = createImageOcrService({ createWorker: async () => worker, isCurrent: () => true });
    const results = await Promise.all([service.recognize(job("a")), service.recognize(job("long"))]);
    expect(maximum).toBe(1);
    expect(order).toEqual(["start:1", "end:1", "start:4", "end:4"]);
    expect(results.map(({ detectedText }) => detectedText)).toEqual(["1", "4"]);
    await service.dispose();
  });

  it("rejects OCR above 20,000 Unicode code points without truncating or retaining content", async () => {
    // Catches silent truncation making a partial OCR string appear reviewed or complete.
    const marker = "PRIVATE-OCR";
    const service = createImageOcrService({
      createWorker: async () => ({
        recognize: async () => marker.repeat(2_001),
        terminate: async () => undefined,
      }),
      isCurrent: () => true,
    });
    await expect(service.recognize(job("large"))).rejects.toSatisfy((error: unknown) => {
      const failure = error as ImageIntakeFailure;
      return issueCode(error) === "OCR_TEXT_LIMIT_EXCEEDED" && !failure.message.includes(marker);
    });
    await service.dispose();
  });

  it("validates the complete custody token before and after recognition", async () => {
    // Catches removed/replaced/reset images accepting an old worker completion.
    let current = true;
    let finish!: (value: string) => void;
    const recognition = new Promise<string>((resolve) => { finish = resolve; });
    const service = createImageOcrService({
      createWorker: async () => ({ recognize: async () => recognition, terminate: async () => undefined }),
      isCurrent: () => current,
    });
    const pending = service.recognize(job("stale"));
    await Promise.resolve();
    current = false;
    finish("OLD");
    await expect(pending).rejects.toSatisfy((error: unknown) => issueCode(error) === "STALE_SESSION");

    await expect(service.recognize(job("already-stale")))
      .rejects.toSatisfy((error: unknown) => issueCode(error) === "STALE_SESSION");
    await service.dispose();
  });

  it("cancels removal/reset work, terminates the active worker, and recreates it for current queued work", async () => {
    // Catches a terminated worker being reused or cancelled item OCR publishing after source custody changes.
    let workerCreates = 0;
    let activeReject: ((reason: unknown) => void) | null = null;
    const service = createImageOcrService({
      createWorker: async () => {
        workerCreates += 1;
        const workerNumber = workerCreates;
        return {
          recognize: workerNumber === 1
            ? async () => new Promise<string>((_resolve, reject) => { activeReject = reject; })
            : async () => "FRESH",
          terminate: async () => {
            activeReject?.(new DOMException("terminated", "AbortError"));
            activeReject = null;
          },
        };
      },
      isCurrent: () => true,
    });
    const removed = service.recognize(job("removed"));
    const fresh = service.recognize(job("fresh"));
    await Promise.resolve();
    await service.cancelItem("removed", "hash-removed");
    await expect(removed).rejects.toMatchObject({ name: "AbortError" });
    await expect(fresh).resolves.toMatchObject({ detectedText: "FRESH" });
    expect(workerCreates).toBe(2);

    const resetPending = service.recognize(job("reset"));
    await Promise.resolve();
    await service.reset();
    await expect(resetPending).rejects.toMatchObject({ name: "AbortError" });
    await service.dispose();
  });

  it("detaches a cancelled recognition that never settles and serially recreates the worker for queued OCR", async () => {
    // Catches a resolved terminate leaving the queue pump blocked forever on Tesseract's stale recognize promise.
    const events: string[] = [];
    let workerCreates = 0;
    const service = createImageOcrService({
      createWorker: async () => {
        workerCreates += 1;
        const workerNumber = workerCreates;
        events.push(`create:${workerNumber}`);
        return {
          recognize: async () => {
            events.push(`recognize:${workerNumber}`);
            return workerNumber === 1 ? new Promise<string>(() => undefined) : "FRESH";
          },
          terminate: async () => {
            await Promise.resolve();
            events.push(`terminate:${workerNumber}`);
          },
        };
      },
      isCurrent: () => true,
    });
    const cancelled = service.recognize(job("cancelled"));
    const queued = service.recognize(job("queued"));
    void cancelled.catch(() => undefined);
    void queued.catch(() => undefined);
    try {
      await vi.waitFor(() => expect(events).toContain("recognize:1"));
      await service.cancelItem("cancelled", "hash-cancelled");
      await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
      await vi.waitFor(() => expect(events).toContain("recognize:2"), { timeout: 200 });
      await expect(queued).resolves.toMatchObject({ detectedText: "FRESH" });
      expect(events.indexOf("terminate:1")).toBeLessThan(events.indexOf("create:2"));
    } finally {
      await service.dispose();
    }
  });

  it("reset detaches a recognition that never settles and permits future OCR on a recreated worker", async () => {
    // Catches a reset settling only its caller while the old queue pump still owns the serial worker lane.
    const events: string[] = [];
    let workerCreates = 0;
    const service = createImageOcrService({
      createWorker: async () => {
        workerCreates += 1;
        const workerNumber = workerCreates;
        events.push(`create:${workerNumber}`);
        return {
          recognize: async () => {
            events.push(`recognize:${workerNumber}`);
            return workerNumber === 1 ? new Promise<string>(() => undefined) : "AFTER-RESET";
          },
          terminate: async () => {
            await Promise.resolve();
            events.push(`terminate:${workerNumber}`);
          },
        };
      },
      isCurrent: () => true,
    });
    const stale = service.recognize(job("before-reset"));
    void stale.catch(() => undefined);
    try {
      await vi.waitFor(() => expect(events).toContain("recognize:1"));
      await service.reset();
      await expect(stale).rejects.toMatchObject({ name: "AbortError" });
      const future = service.recognize(job("after-reset"));
      await expect(future).resolves.toMatchObject({ detectedText: "AFTER-RESET" });
      expect(events.indexOf("terminate:1")).toBeLessThan(events.indexOf("create:2"));
    } finally {
      await service.dispose();
    }
  });
});
