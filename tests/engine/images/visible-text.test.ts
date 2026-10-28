import { readVisibleText } from "../../../src/engine/images";

const recognizeText = vi.hoisted(() => vi.fn());
vi.mock("../../../src/engine/ocr", () => ({ recognizeText }));

const image = new Blob(["image"], { type: "image/png" });

describe("readVisibleText", () => {
  it("tidies the recognized text and passes the signal on", async () => {
    recognizeText.mockResolvedValueOnce({
      text: "  SALE  \r\nToday only\t\r\n\r\n\r\n\r\n50% off ",
      confidence: 91,
    });
    const signal = new AbortController().signal;
    expect(await readVisibleText(image, signal)).toBe("SALE\nToday only\n\n50% off");
    expect(recognizeText).toHaveBeenCalledWith(image, signal);
  });

  it("refuses more text than can be kept", async () => {
    recognizeText.mockResolvedValueOnce({ text: "x".repeat(20_001), confidence: 90 });
    await expect(readVisibleText(image)).rejects.toThrow(
      "This image has more text than can be kept (over 20,000 characters).",
    );
  });

  it("turns failures into a plain message but lets cancellation through", async () => {
    recognizeText.mockRejectedValueOnce(new Error("worker crashed"));
    await expect(readVisibleText(image)).rejects.toThrow("Couldn't read the text in this image.");
    const controller = new AbortController();
    controller.abort();
    recognizeText.mockRejectedValueOnce(controller.signal.reason);
    await expect(readVisibleText(image, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
