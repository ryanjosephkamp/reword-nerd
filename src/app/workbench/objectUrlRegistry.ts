export interface ObjectUrlLease {
  url: string;
  release(): void;
}

interface RegistryEntry {
  url: string;
  subscribers: number;
}

export class ObjectUrlRegistry {
  private readonly entries = new Map<string, RegistryEntry>();

  constructor(
    private readonly create: (blob: Blob) => string = (blob) => URL.createObjectURL(blob),
    private readonly revoke: (url: string) => void = (url) => URL.revokeObjectURL(url),
  ) {}

  acquire(key: string, bytes: Uint8Array, mimeType: string): ObjectUrlLease {
    let entry = this.entries.get(key);
    if (!entry) {
      const owned = bytes.slice();
      entry = { url: this.create(new Blob([owned.buffer], { type: mimeType })), subscribers: 0 };
      this.entries.set(key, entry);
    }
    entry.subscribers += 1;
    let released = false;
    return {
      url: entry.url,
      release: () => {
        if (released) return;
        released = true;
        const current = this.entries.get(key);
        if (!current) return;
        current.subscribers -= 1;
        if (current.subscribers <= 0) {
          this.entries.delete(key);
          this.revoke(current.url);
        }
      },
    };
  }

  disposeAll(): void {
    for (const entry of this.entries.values()) this.revoke(entry.url);
    this.entries.clear();
  }
}

export const previewObjectUrls = new ObjectUrlRegistry();
