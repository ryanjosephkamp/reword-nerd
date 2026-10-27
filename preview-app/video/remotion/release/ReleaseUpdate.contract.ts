import { z } from "zod";

export const RELEASE_UPDATE_SIZE = { width: 1280, height: 720 } as const;
export const RELEASE_UPDATE_FPS = 30;
export const RELEASE_UPDATE_DURATION_IN_FRAMES = 720;

export const ReleaseUpdateSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/u),
  title: z.string().min(12).max(88),
  context: z.string().min(24).max(180),
  demonstrationLabel: z.string().min(8).max(48),
  highlights: z.array(z.string().min(3).max(72)).length(3),
  feedback: z.object({
    bugLabel: z.string().min(3).max(48),
    featureLabel: z.string().min(3).max(48),
    shareLabel: z.string().min(3).max(48),
    closingLine: z.string().min(12).max(120),
  }),
});

export type ReleaseUpdateProps = z.infer<typeof ReleaseUpdateSchema>;

export const releaseUpdateDefaultProps: ReleaseUpdateProps = {
  version: "0.7.0",
  title: "Updates, feedback, and Share",
  context: "A static builder’s journal and small community routes make each release easier to inspect, discuss, and pass along without adding a publishing backend.",
  demonstrationLabel: "See the release surface in action",
  highlights: [
    "Static Updates pages with RSS",
    "Clear bug and feature routes",
    "Canonical Share with no tracking",
  ],
  feedback: {
    bugLabel: "REPORT A BUG",
    featureLabel: "SUGGEST A FEATURE",
    shareLabel: "SHARE RELEASE",
    closingLine: "Built in public. Processed locally.",
  },
};
