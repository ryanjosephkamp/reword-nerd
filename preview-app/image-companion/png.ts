import { nodeRuntime } from "./nodeRuntime";
import { createPngInspector } from "./portable/png";
export { PNG_LIMITS, PngValidationError, crc32 } from "./portable/png";
export const inspectPng = createPngInspector(nodeRuntime);
