import type { PdfImageData } from "../../../src/engine/images/pdfImages";

interface Sent {
  message: { id: number; width: number; bitmap?: unknown; rgba?: Uint8ClampedArray };
  transfer: Transferable[];
}

/** Stands in for the encoder worker: replies with a blob, or fails to start. */
function fakeWorker(mode: "works" | "fails") {
  const sent: Sent[] = [];
  class FakeWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    postMessage(message: Sent["message"], transfer: Transferable[]) {
      sent.push({ message, transfer });
      setTimeout(() => {
        if (mode === "fails") this.onerror?.();
        else this.onmessage?.({ data: { id: message.id, blob: new Blob(["png"]) } });
      }, 0);
    }
    terminate() {}
  }
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("OffscreenCanvas", class {});
  return sent;
}

async function encoder() {
  vi.resetModules();
  return (await import("../../../src/engine/images/pngEncoder")).encodePdfImageAsPng;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("encodePdfImageAsPng", () => {
  it("sends the worker a copy of pdf.js's bitmap, which pdf.js may still need", async () => {
    const sent = fakeWorker("works");
    const copy = { copy: true };
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => copy),
    );
    const original = { original: true } as unknown as ImageBitmap;
    const encode = await encoder();
    const blob = await encode({ width: 40, height: 30, bitmap: original });
    expect(await blob.text()).toBe("png");
    expect(createImageBitmap).toHaveBeenCalledWith(original);
    expect(sent[0].message).toMatchObject({ width: 40, bitmap: copy });
    expect(sent[0].transfer).toEqual([copy]);
  });

  it("sends raw pixels as RGBA and hands over the buffer", async () => {
    const sent = fakeWorker("works");
    const encode = await encoder();
    const image: PdfImageData = { width: 1, height: 1, kind: 2, data: Uint8Array.of(1, 2, 3) };
    await encode(image);
    expect(Array.from(sent[0].message.rgba ?? [])).toEqual([1, 2, 3, 255]);
    expect(sent[0].transfer).toEqual([sent[0].message.rgba?.buffer]);
  });

  it("falls back to a page canvas when the worker can't start", async () => {
    fakeWorker("fails");
    const encode = await encoder();
    // jsdom has no canvas, so reaching the fallback shows up as its error.
    await expect(
      encode({ width: 1, height: 1, kind: 3, data: Uint8Array.of(1, 2, 3, 4) }),
    ).rejects.toThrow("This browser can't draw pictures.");
  });
});

describe("encoder worker lifetime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A worker that replies only when told to, and records whether it was stopped. */
  function heldWorker() {
    const state = { terminated: 0, reply: (): void => undefined };
    class HeldWorker {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror: (() => void) | null = null;
      postMessage(message: { id: number }) {
        state.reply = () => this.onmessage?.({ data: { id: message.id, blob: new Blob(["png"]) } });
      }
      terminate() {
        state.terminated += 1;
      }
    }
    vi.stubGlobal("Worker", HeldWorker);
    vi.stubGlobal("OffscreenCanvas", class {});
    return state;
  }

  const pixels = () => ({ width: 1, height: 1, kind: 2, data: Uint8Array.of(1, 2, 3) });

  it("gives up on a picture the worker never saves, instead of hanging", async () => {
    // Catches an encode waiting forever on a stuck or crashed worker.
    vi.useFakeTimers();
    const state = heldWorker();
    const encode = await encoder();
    const job = encode(pixels());
    const outcome = job.then(
      () => "saved",
      (error: Error) => error.message,
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await outcome).toBe("Saving the picture took too long.");
    expect(state.terminated).toBe(1);
  });

  it("doesn't let the idle stop end the worker while a picture is being prepared", async () => {
    // Catches the idle timer terminating the worker during createImageBitmap, leaving the job
    // posted to a dead worker forever.
    vi.useFakeTimers();
    const state = heldWorker();
    let release: (bitmap: unknown) => void = () => undefined;
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => new Promise((resolve) => (release = resolve))),
    );
    const encode = await encoder();
    const first = encode(pixels());
    await vi.advanceTimersByTimeAsync(0);
    state.reply();
    await first;
    const second = encode({ width: 1, height: 1, bitmap: {} as ImageBitmap });
    await vi.advanceTimersByTimeAsync(31_000);
    release({ copy: true });
    await vi.advanceTimersByTimeAsync(0);
    state.reply();
    expect(await (await second).text()).toBe("png");
    expect(state.terminated).toBe(0);
  });
});
