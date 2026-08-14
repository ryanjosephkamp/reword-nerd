import { PREFERENCES_STORAGE_KEY, decodeSavedPreferences } from "../../src/app/workbench/preferences";
import { DEFAULT_IMAGE_PROMPT_SETTINGS } from "../../src/image/contracts";
import {
  CURRENT_IMAGE_TUTORIAL_VERSION,
  IMAGE_PREFERENCES_STORAGE_KEY,
  clearImagePreferences,
  decodeImagePreferences,
  encodeImagePreferences,
  loadImagePreferences,
  saveImagePreferences,
  snapshotImagePreferences,
} from "../../src/image/preferences";

class RecordingStorage {
  readonly values = new Map<string, string>();
  readonly calls: string[] = [];

  getItem(key: string): string | null {
    this.calls.push(`get:${key}`);
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.calls.push(`set:${key}`);
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.calls.push(`remove:${key}`);
    this.values.delete(key);
  }
}

describe("Image preferences", () => {
  it("persists only validated defaults and the tutorial marker", () => {
    // Catches session data such as bytes, paths, OCR, selections, prompts, or packages entering localStorage.
    const serialized = encodeImagePreferences({
      defaults: {
        ...DEFAULT_IMAGE_PROMPT_SETTINGS,
        modelFamily: "ideogram",
        aspectRatio: "4:3",
        requestedChanges: "Use a cream background.",
      },
      tutorialVersion: CURRENT_IMAGE_TUTORIAL_VERSION,
      bytes: [137, 80, 78, 71],
      filename: "private.png",
      path: "/private/private.png",
      bulkSelected: true,
      ocr: "PRIVATE OCR",
      prompt: "PRIVATE PROMPT",
      package: "PRIVATE PACKAGE",
    } as unknown as Parameters<typeof encodeImagePreferences>[0]);

    expect(JSON.parse(serialized)).toEqual({
      version: 1,
      data: {
        defaults: {
          modelFamily: "ideogram",
          aspectRatio: "4:3",
          sizeIntent: "match-source-where-supported",
          preserveVisibleText: true,
          backgroundBehavior: "preserve-source",
          requestedChanges: "Use a cream background.",
          mustPreserve: "",
        },
        tutorialVersion: "0.8",
      },
    });
    expect(serialized).not.toMatch(/private|bytes|filename|path|bulkSelected|ocr|prompt|package/iu);
  });

  it("drops malformed and unsupported preference fields without failing closed over valid defaults", () => {
    // Catches unvalidated persisted values becoming active settings after reload.
    const decoded = decodeImagePreferences(JSON.stringify({
      version: 1,
      data: {
        defaults: {
          modelFamily: "not-a-family",
          aspectRatio: "9:16",
          sizeIntent: "enormous",
          preserveVisibleText: false,
          backgroundBehavior: "remove-everything",
          requestedChanges: "Keep this valid field.",
          mustPreserve: 42,
          sourceName: "private.png",
        },
        tutorialVersion: "0.8",
        selectedItemId: "private-item",
      },
    }));

    expect(decoded).toEqual({
      defaults: {
        aspectRatio: "9:16",
        preserveVisibleText: false,
        requestedChanges: "Keep this valid field.",
      },
      tutorialVersion: "0.8",
    });
    expect(decodeImagePreferences("not json")).toBeNull();
    expect(decodeImagePreferences(JSON.stringify({ version: 2, data: {} }))).toBeNull();
  });

  it("reads, writes, and clears only the dedicated Image preference key", () => {
    // Catches Image reset or save operations touching Text or unrelated storage keys.
    const storage = new RecordingStorage();
    storage.values.set(PREFERENCES_STORAGE_KEY, "text-preferences-must-stay");
    storage.values.set("unrelated", "must-stay");
    const snapshot = snapshotImagePreferences(DEFAULT_IMAGE_PROMPT_SETTINGS, "0.8");

    saveImagePreferences(snapshot, storage);
    expect(loadImagePreferences(storage)).toEqual(snapshot);
    clearImagePreferences(storage);

    expect(storage.calls).toEqual([
      `set:${IMAGE_PREFERENCES_STORAGE_KEY}`,
      `get:${IMAGE_PREFERENCES_STORAGE_KEY}`,
      `remove:${IMAGE_PREFERENCES_STORAGE_KEY}`,
    ]);
    expect(storage.values.get(PREFERENCES_STORAGE_KEY)).toBe("text-preferences-must-stay");
    expect(storage.values.get("unrelated")).toBe("must-stay");
  });

  it("treats unavailable storage as optional", () => {
    // Catches browser privacy/storage failures breaking the in-memory Image workbench.
    const throwingStorage = {
      getItem(): string | null { throw new Error("blocked"); },
      setItem(): void { throw new Error("blocked"); },
      removeItem(): void { throw new Error("blocked"); },
    };

    expect(loadImagePreferences(throwingStorage)).toBeNull();
    expect(() => saveImagePreferences(snapshotImagePreferences(DEFAULT_IMAGE_PROMPT_SETTINGS, null), throwingStorage)).not.toThrow();
    expect(() => clearImagePreferences(throwingStorage)).not.toThrow();
  });

  it("leaves the Text preference key and decoder behavior unchanged", () => {
    // Catches accidental reuse or broadening of the protected Text preference namespace.
    expect(PREFERENCES_STORAGE_KEY).toBe("reword-nerd:preferences:v1");
    expect(IMAGE_PREFERENCES_STORAGE_KEY).toBe("reword-nerd:image-preferences:v1");
    expect(decodeSavedPreferences(JSON.stringify({
      version: 1,
      data: { selectedProfileId: "openai-general", tutorialVersion: "0.5" },
    }))).toEqual({ selectedProfileId: "openai-general", tutorialVersion: "0.5" });
  });
});
