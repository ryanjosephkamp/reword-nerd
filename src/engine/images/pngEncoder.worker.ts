// Encodes pictures as PNG off the main thread. On the main thread, Chrome waits for idle
// time before encoding a canvas, which a background tab rarely has: about a second per
// picture, against a few milliseconds here.

interface EncodeRequest {
  id: number;
  width: number;
  height: number;
  bitmap?: ImageBitmap;
  rgba?: Uint8ClampedArray<ArrayBuffer>;
}

addEventListener("message", async (event: MessageEvent<EncodeRequest>) => {
  const { id, width, height, bitmap, rgba } = event.data;
  try {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No 2D canvas in this worker.");
    if (bitmap) {
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
    } else if (rgba) {
      context.putImageData(new ImageData(rgba, width, height), 0, 0);
    }
    postMessage({ id, blob: await canvas.convertToBlob({ type: "image/png" }) });
  } catch (error) {
    postMessage({ id, error: String(error) });
  }
});
