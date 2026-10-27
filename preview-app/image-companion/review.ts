import { nodeRuntime } from "./nodeRuntime";
import { createReviewRenderer } from "./portable/review";
export type { ImageReviewModel, ImageReviewAttempt } from "./portable/review";
export const renderImageReview=createReviewRenderer(nodeRuntime);
