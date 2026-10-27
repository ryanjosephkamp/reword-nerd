import type { PromptBinding } from "../domain/contracts";
export function hydrateBoundPrompt(prompt: string, slots: readonly PromptBinding[], responses: Readonly<Record<string, string>>): string;
