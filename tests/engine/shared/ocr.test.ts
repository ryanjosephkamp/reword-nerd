const createWorker = vi.fn();

vi.mock("tesseract.js", () => ({ createWorker, OEM: { LSTM_ONLY: 1 } }));

async function ocr() {
  vi.resetModules();
  return import("../../../src/engine/ocr");
}

function worker(text = "Hello") {
  return {
    recognize: vi.fn(async () => ({ data: { text: ` ${text} `, confidence: 88 } })),
    terminate: vi.fn(async () => undefined),
  };
}

afterEach(() => {
  createWorker.mockReset();
  vi.useRealTimers();
});

describe("shared OCR", () => {
  it("starts a fresh worker after a failed start instead of failing for a minute", async () => {
    // Catches a failed start being cached, so every later call fails until the idle stop.
    const { recognizeText, disposeOcr } = await ocr();
    const working = worker();
    createWorker.mockRejectedValueOnce(new Error("couldn't load")).mockResolvedValueOnce(working);

    await expect(recognizeText(new Blob())).rejects.toThrow("couldn't load");
    await expect(recognizeText(new Blob())).resolves.toEqual({ text: "Hello", confidence: 88 });
    expect(createWorker).toHaveBeenCalledTimes(2);
    await disposeOcr();
    expect(working.terminate).toHaveBeenCalled();
  });

  it("stops safely after a failed start, with no unhandled rejection", async () => {
    vi.useFakeTimers();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const { recognizeText, disposeOcr } = await ocr();
      createWorker.mockRejectedValue(new Error("couldn't load"));
      await expect(recognizeText(new Blob())).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(60_000);
      await expect(disposeOcr()).resolves.toBeUndefined();
      await vi.advanceTimersByTimeAsync(0);
    } finally {
      process.off("unhandledRejection", unhandled);
    }
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("gives Tesseract an error handler so a failed job rejects instead of throwing", async () => {
    const { recognizeText } = await ocr();
    createWorker.mockResolvedValueOnce(worker());
    await recognizeText(new Blob());
    expect(createWorker.mock.calls[0][2]).toMatchObject({ errorHandler: expect.any(Function) });
  });
});
