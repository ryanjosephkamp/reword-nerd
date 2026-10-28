// Small helpers shared by the text readers.

/** A file or project that can't be read, with a reason written for the user. */
export class ReadProblem extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ReadProblem";
  }
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/** "a", "a and b", or "a, b, and c". */
export function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

/** Like listWords, but names at most `max` items and counts the rest. */
export function listSome(items: readonly string[], max = 5): string {
  if (items.length <= max) return listWords(items);
  return listWords([...items.slice(0, max), `${items.length - max} more`]);
}

/** "Page 3 has" or "Pages 3 and 4 have", for the start of a sentence. */
export function pagesHave(pages: readonly number[]): string {
  const numbers = listSome(pages.map(String), 10);
  return pages.length === 1 ? `Page ${numbers} has` : `Pages ${numbers} have`;
}

/** "page 3" or "pages 3 and 4", for the middle of a sentence. */
export function pagesPhrase(pages: readonly number[]): string {
  const numbers = listSome(pages.map(String), 10);
  return pages.length === 1 ? `page ${numbers}` : `pages ${numbers}`;
}

export function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
