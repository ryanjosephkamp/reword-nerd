import "@testing-library/jest-dom/vitest";

// jsdom's Blob has no stream(); the ZIP library needs it.
if (typeof Blob.prototype.stream !== "function") {
  Blob.prototype.stream = function stream(this: Blob) {
    const read = () => this.arrayBuffer();
    return new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(new Uint8Array(await read()));
        controller.close();
      },
    });
  } as Blob["stream"];
}
