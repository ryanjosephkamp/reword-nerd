import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  APPEARANCE_STORAGE_KEY,
  AppearanceControls,
  useAppearance,
} from "../src/app/platform/appearance";

function Harness() {
  const appearance = useAppearance();
  return (
    <div
      data-testid="appearance"
      data-palette={appearance.palette}
      data-appearance={appearance.mode}
    >
      <AppearanceControls {...appearance} />
    </div>
  );
}

let entries: Map<string, string>;
let storage: Storage;
let originalStorage: PropertyDescriptor | undefined;

beforeEach(() => {
  entries = new Map();
  storage = {
    getItem: vi.fn((key: string) => entries.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      entries.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      entries.delete(key);
    }),
    clear: vi.fn(() => entries.clear()),
    key: vi.fn((index: number) => Array.from(entries.keys())[index] ?? null),
    get length() {
      return entries.size;
    },
  };
  originalStorage = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
});

afterEach(() => {
  cleanup();
  if (originalStorage)
    Object.defineProperty(window, "localStorage", originalStorage);
  vi.restoreAllMocks();
});

describe("shared appearance", () => {
  it("starts with graphite and dark mode without reading unrelated preferences", () => {
    entries.set("another-app:document", "keep this untouched");
    render(<Harness />);

    expect(screen.getByTestId("appearance")).toHaveAttribute(
      "data-palette",
      "graphite",
    );
    expect(screen.getByTestId("appearance")).toHaveAttribute(
      "data-appearance",
      "dark",
    );
    expect(storage.getItem).toHaveBeenCalledWith(APPEARANCE_STORAGE_KEY);
    expect(entries.get("another-app:document")).toBe("keep this untouched");
    expect(JSON.parse(entries.get(APPEARANCE_STORAGE_KEY)!)).toEqual({
      version: 1,
      palette: "graphite",
      mode: "dark",
    });
  });

  it("changes palette and mode independently, then restores both on a fresh mount", () => {
    const first = render(<Harness />);
    fireEvent.change(screen.getByLabelText("Color palette"), {
      target: { value: "amber" },
    });
    expect(screen.getByTestId("appearance")).toHaveAttribute(
      "data-appearance",
      "dark",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Switch to light appearance" }),
    );
    expect(screen.getByTestId("appearance")).toHaveAttribute(
      "data-palette",
      "amber",
    );
    expect(JSON.parse(entries.get(APPEARANCE_STORAGE_KEY)!)).toEqual({
      version: 1,
      palette: "amber",
      mode: "light",
    });
    first.unmount();

    render(<Harness />);
    expect(screen.getByLabelText("Color palette")).toHaveValue("amber");
    expect(
      screen.getByRole("button", { name: "Switch to dark appearance" }),
    ).toBeInTheDocument();
  });

  it.each([
    "{broken json",
    JSON.stringify({ version: 9, palette: "original", mode: "light" }),
    JSON.stringify({ version: 1, palette: "unsupported", mode: "dark" }),
    JSON.stringify({ version: 1, palette: "lime", mode: "automatic" }),
    JSON.stringify(null),
    "x".repeat(1025),
  ])(
    "discards an invalid stored value without breaking the controls: %s",
    (stored) => {
      entries.set(APPEARANCE_STORAGE_KEY, stored);
      render(<Harness />);
      expect(screen.getByLabelText("Color palette")).toHaveValue("graphite");
      expect(screen.getByTestId("appearance")).toHaveAttribute(
        "data-appearance",
        "dark",
      );
      fireEvent.change(screen.getByLabelText("Color palette"), {
        target: { value: "lime" },
      });
      expect(screen.getByTestId("appearance")).toHaveAttribute(
        "data-palette",
        "lime",
      );
    },
  );

  it("persists only allowed preference fields, stripping unrelated stored content", () => {
    entries.set(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        palette: "original",
        mode: "light",
        document: "This must never be retained in the appearance preference.",
        credential: "not-a-real-credential",
      }),
    );
    render(<Harness />);

    expect(screen.getByLabelText("Color palette")).toHaveValue("original");
    expect(JSON.parse(entries.get(APPEARANCE_STORAGE_KEY)!)).toEqual({
      version: 1,
      palette: "original",
      mode: "light",
    });
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(storage.clear).not.toHaveBeenCalled();
  });

  it("keeps controls functional when browser storage is blocked", () => {
    vi.mocked(storage.getItem).mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    vi.mocked(storage.setItem).mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    render(<Harness />);

    fireEvent.change(screen.getByLabelText("Color palette"), {
      target: { value: "original" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Switch to light appearance" }),
    );
    expect(screen.getByTestId("appearance")).toHaveAttribute(
      "data-palette",
      "original",
    );
    expect(screen.getByTestId("appearance")).toHaveAttribute(
      "data-appearance",
      "light",
    );
  });
});
