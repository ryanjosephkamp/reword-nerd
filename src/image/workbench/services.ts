import {
  createBrowserImageIntakeService,
  type BrowserImageIntakeServiceOptions,
  type ImageIntakeService,
} from "../intake";
import {
  createImageOcrService,
  type ImageOcrService,
  type ImageOcrServiceOptions,
} from "../ocrService";
import { ImageObjectUrlRegistry } from "../objectUrlRegistry";

export interface ImageWorkbenchServices {
  readonly createIntake: (options: BrowserImageIntakeServiceOptions) => ImageIntakeService;
  readonly createOcr: (options: ImageOcrServiceOptions) => ImageOcrService;
  readonly createObjectUrls: () => ImageObjectUrlRegistry;
}

let fallbackOccurrence = 0;

export function createImageOccurrenceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `image-${crypto.randomUUID()}`;
  }
  fallbackOccurrence += 1;
  return `image-occurrence-${fallbackOccurrence}`;
}

export const defaultImageWorkbenchServices: ImageWorkbenchServices = Object.freeze({
  createIntake: createBrowserImageIntakeService,
  createOcr: createImageOcrService,
  createObjectUrls: () => new ImageObjectUrlRegistry(),
});
