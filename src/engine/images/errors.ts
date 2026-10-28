/** What kind of problem stopped an image from being added, so summaries can group them. */
export type ImageProblem = "unsupported" | "too-large" | "unreadable";

/** A failure whose message is written for the person using the app. */
export class ImageReadError extends Error {
  constructor(
    message: string,
    readonly problem: ImageProblem = "unreadable",
    /** The file format's name, when the problem is an unsupported format. */
    readonly format?: string,
  ) {
    super(message);
    this.name = "ImageReadError";
  }
}

/** Cancellation must stop the whole read, never turn into a per-file rejection. */
export function rethrowIfAborted(error: unknown, signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? error;
  if (error instanceof DOMException && error.name === "AbortError") throw error;
}

/** The message to show for any failure; internal error text never reaches the user. */
export function reasonFor(error: unknown, fallback: string): string {
  return error instanceof ImageReadError ? error.message : fallback;
}
