export type ImageObjectUrlPurpose = "thumbnail" | "focused" | "ocr" | "download";

export interface ImageObjectUrlKey {
  readonly occurrenceId: string;
  readonly sourceHash: string;
  readonly purpose: ImageObjectUrlPurpose;
}

export interface ImageObjectUrlLease {
  readonly url: string;
  release(): void;
}

interface RegistryEntry {
  readonly key: ImageObjectUrlKey;
  readonly url: string;
  subscribers: number;
}

function serializedKey(key: ImageObjectUrlKey): string {
  return JSON.stringify([key.occurrenceId, key.sourceHash, key.purpose]);
}

export class ImageObjectUrlRegistry {
  private readonly entries = new Map<string, RegistryEntry>();

  constructor(
    private readonly create: (blob: Blob) => string = (blob) => URL.createObjectURL(blob),
    private readonly revoke: (url: string) => void = (url) => URL.revokeObjectURL(url),
  ) {}

  acquire(key: ImageObjectUrlKey, sourceBytes: Blob): ImageObjectUrlLease {
    const storageKey = serializedKey(key);
    let entry = this.entries.get(storageKey);
    if (!entry) {
      entry = {
        key: Object.freeze({ ...key }),
        url: this.create(sourceBytes),
        subscribers: 0,
      };
      this.entries.set(storageKey, entry);
    }
    entry.subscribers += 1;
    let released = false;
    return {
      url: entry.url,
      release: () => {
        if (released) return;
        released = true;
        const current = this.entries.get(storageKey);
        if (!current) return;
        current.subscribers -= 1;
        if (current.subscribers <= 0) {
          this.entries.delete(storageKey);
          this.revoke(current.url);
        }
      },
    };
  }

  disposeOccurrence(occurrenceId: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.key.occurrenceId !== occurrenceId) continue;
      this.entries.delete(key);
      this.revoke(entry.url);
    }
  }

  disposeAll(): void {
    for (const entry of this.entries.values()) this.revoke(entry.url);
    this.entries.clear();
  }
}
