// Where a job can be handed off. Picking one changes only the mechanics of the hand-off
// (paste, attach, or download a task folder), never the wording of the rewrite instructions.

export type DestinationKind = "agent" | "chat" | "image";

export type DestinationId =
  | "claude-code"
  | "codex"
  | "gemini-cli"
  | "other-agent"
  | "chatgpt"
  | "claude"
  | "gemini"
  | "grok"
  | "other-chat"
  | "grok-imagine"
  | "chatgpt-images"
  | "gemini-images"
  | "midjourney"
  | "codex-images"
  | "other-image";

export interface Destination {
  id: DestinationId;
  kind: DestinationKind;
  label: string;
  /** Where the web app lives, for "Copy and open". */
  url?: string;
  /** For agents: how to start the agent in the task folder with its first instruction. */
  launch?: (instruction: string) => string;
  /** Agents that can generate images take an image task folder; everything else gets prompts. */
  forImages: boolean;
  forText: boolean;
  hint: string;
}

const quote = (instruction: string) => `"${instruction.replaceAll('"', '\\"')}"`;

export const DESTINATIONS: readonly Destination[] = [
  {
    id: "claude-code",
    kind: "agent",
    label: "Claude Code",
    launch: (instruction) => `claude ${quote(instruction)}`,
    forText: true,
    forImages: false,
    hint: "Runs all four stages and writes the files. Approve its file writes when it asks.",
  },
  {
    id: "codex",
    kind: "agent",
    label: "Codex",
    launch: (instruction) => `codex ${quote(instruction)}`,
    forText: true,
    forImages: false,
    hint: "Runs all four stages and writes the files. Approve its file writes when it asks.",
  },
  {
    id: "gemini-cli",
    kind: "agent",
    label: "Gemini CLI",
    launch: (instruction) => `gemini -i ${quote(instruction)}`,
    forText: true,
    forImages: false,
    hint: "Runs all four stages and writes the files. Approve its file writes when it asks.",
  },
  {
    id: "other-agent",
    kind: "agent",
    label: "Another agent",
    forText: true,
    forImages: false,
    hint: "Open the folder in your agent and tell it: Follow TASK.md.",
  },
  {
    id: "chatgpt",
    kind: "chat",
    label: "ChatGPT",
    url: "https://chatgpt.com/",
    forText: true,
    forImages: false,
    hint: "Paste the prompt into a new chat.",
  },
  {
    id: "claude",
    kind: "chat",
    label: "Claude",
    url: "https://claude.ai/new",
    forText: true,
    forImages: false,
    hint: "Paste the prompt into a new chat.",
  },
  {
    id: "gemini",
    kind: "chat",
    label: "Gemini",
    url: "https://gemini.google.com/app",
    forText: true,
    forImages: false,
    hint: "Paste the prompt into a new chat.",
  },
  {
    id: "grok",
    kind: "chat",
    label: "Grok",
    url: "https://grok.com/",
    forText: true,
    forImages: false,
    hint: "Paste the prompt into a new chat.",
  },
  {
    id: "other-chat",
    kind: "chat",
    label: "Another chat app",
    forText: true,
    forImages: false,
    hint: "Paste the prompt into a new chat.",
  },
  {
    id: "grok-imagine",
    kind: "image",
    label: "Grok Imagine",
    url: "https://grok.com/imagine",
    forText: false,
    forImages: true,
    hint: "Attach the image, then paste its prompt.",
  },
  {
    id: "chatgpt-images",
    kind: "image",
    label: "ChatGPT",
    url: "https://chatgpt.com/",
    forText: false,
    forImages: true,
    hint: "Attach the image, then paste its prompt.",
  },
  {
    id: "gemini-images",
    kind: "image",
    label: "Gemini",
    url: "https://gemini.google.com/app",
    forText: false,
    forImages: true,
    hint: "Attach the image, then paste its prompt.",
  },
  {
    id: "midjourney",
    kind: "image",
    label: "Midjourney",
    url: "https://www.midjourney.com/imagine",
    forText: false,
    forImages: true,
    hint: "Add the image as an image prompt, then paste its prompt.",
  },
  {
    id: "codex-images",
    kind: "agent",
    label: "Codex",
    launch: (instruction) => `codex ${quote(instruction)}`,
    forText: false,
    forImages: true,
    hint: "Regenerates every image in the folder from one command.",
  },
  {
    id: "other-image",
    kind: "image",
    label: "Another image tool",
    forText: false,
    forImages: true,
    hint: "Attach the image, then paste its prompt.",
  },
];

export function destination(id: DestinationId): Destination {
  const found = DESTINATIONS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Unknown destination: ${id}`);
  return found;
}

export const DEFAULT_TEXT_DESTINATION: DestinationId = "claude-code";
export const DEFAULT_IMAGE_DESTINATION: DestinationId = "grok-imagine";
