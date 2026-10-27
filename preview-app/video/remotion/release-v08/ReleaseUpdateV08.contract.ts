import { z } from "zod";

export const RELEASE_UPDATE_V08_SIZE = { width: 1280, height: 720 } as const;
export const RELEASE_UPDATE_V08_FPS = 30;
export const RELEASE_UPDATE_V08_DURATION_IN_FRAMES = 720;

export const ReleaseUpdateV08Schema = z.object({
  version: z.literal("0.8.0"),
  accent: z.literal("#ff9f1c"),
  title: z.string().min(12).max(72),
  subtitle: z.string().min(20).max(140),
  closingLine: z.string().min(20).max(120),
});

export type ReleaseUpdateV08Props = z.infer<typeof ReleaseUpdateV08Schema>;

export const releaseUpdateV08DefaultProps: ReleaseUpdateV08Props = {
  version: "0.8.0",
  accent: "#ff9f1c",
  title: "IMAGE prompt packages",
  subtitle: "Added a local-first companion workbench, then polished review and export across both portals.",
  closingLine: "No model runs. Nothing uploads. Download only when ready.",
};
