import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ownImageBytes, type ImageProvenance } from "../../src/image/contracts";
import type {
  BrowserImageIntakeServiceOptions,
  ImageAdmission,
  ImageIntakeService,
} from "../../src/image/intake";
import { ImageObjectUrlRegistry } from "../../src/image/objectUrlRegistry";
import { IMAGE_PREFERENCES_STORAGE_KEY } from "../../src/image/preferences";
import { ImageWorkbench } from "../../src/image/workbench/ImageWorkbench";
import { ImagePackagePreview } from "../../src/image/workbench/ImagePackagePreview";
import {
  MAX_ACTIVE_IMAGE_PACKAGE_PREVIEWS,
  updateImagePackagePreviewWindow,
} from "../../src/image/workbench/packagePreviewWindow";
import type { ImageWorkbenchServices } from "../../src/image/workbench/services";
import { MAX_ACTIVE_IMAGE_THUMBNAILS, updateImageThumbnailWindow } from "../../src/image/workbench/thumbnailWindow";
import { useImageObjectUrl } from "../../src/image/workbench/useImageObjectUrl";

const HASH = "c".repeat(64);
const provenance: ImageProvenance = {
  intakeKind: "direct",
  sourceName: "lease.png",
  sourcePath: null,
  containerChain: [],
  containerName: null,
  containerHash: null,
  containerPath: null,
  pageNumber: null,
  relationshipId: null,
};

function setViewport(width: number): void {
  vi.stubGlobal("innerWidth", width);
  vi.stubGlobal("matchMedia", vi.fn((query: string) => {
    const minimum = /min-width:\s*(\d+)px/u.exec(query)?.[1];
    const maximum = /max-width:\s*(\d+)px/u.exec(query)?.[1];
    const matches = (!minimum || width >= Number(minimum))
      && (!maximum || width <= Number(maximum));
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    };
  }));
}

function installResponsiveViewport(initialWidth: number) {
  let width = initialWidth;
  const listeners = new Set<(event: Event) => void>();
  vi.stubGlobal("innerWidth", width);
  vi.stubGlobal("matchMedia", vi.fn((query: string) => {
    const matches = () => {
      const minimum = /min-width:\s*(\d+)px/u.exec(query)?.[1];
      const maximum = /max-width:\s*(\d+)px/u.exec(query)?.[1];
      return (!minimum || width >= Number(minimum)) && (!maximum || width <= Number(maximum));
    };
    return {
      get matches() { return matches(); },
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: (event: Event) => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: Event) => void) => listeners.delete(listener),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    };
  }));
  return {
    resize(nextWidth: number) {
      width = nextWidth;
      vi.stubGlobal("innerWidth", width);
      for (const listener of listeners) listener(new Event("change"));
    },
  };
}

function rememberTutorial(): void {
  window.localStorage.setItem(
    IMAGE_PREFERENCES_STORAGE_KEY,
    JSON.stringify({ version: 1, data: { tutorialVersion: "0.8-image-quick-start" } }),
  );
}

function admission(index = 1): ImageAdmission {
  return {
    id: `lease-occurrence-${index}`,
    ordinal: index - 1,
    sourceBytes: ownImageBytes(new Uint8Array([index]), "image/png"),
    byteCount: 1,
    mimeType: "image/png",
    fileExtension: "png",
    sourceHash: `${HASH.slice(0, -2)}${String(index).padStart(2, "0")}`,
    width: 12,
    height: 8,
    warnings: [],
    provenance: { ...provenance, sourceName: `lease-${index}.png` },
  };
}

function workbenchHarness(itemCount = 1) {
  const items = Array.from({ length: itemCount }, (_, index) => admission(index + 1));
  const created: string[] = [];
  const revoked: string[] = [];
  const live = new Set<string>();
  let sequence = 0;
  const objectUrls = new ImageObjectUrlRegistry(
    () => {
      const url = `blob:workbench-lease-${++sequence}`;
      created.push(url);
      live.add(url);
      return url;
    },
    (url) => {
      revoked.push(url);
      live.delete(url);
    },
  );
  let options!: BrowserImageIntakeServiceOptions;
  const intake = vi.fn(async () => {
    for (const item of items) options.publish(item, 0);
    return {
      admissions: items,
      ledger: items.map((item) => ({
        inputName: item.provenance.sourceName,
        path: null,
        status: "accepted" as const,
        occurrenceId: item.id,
        issue: null,
      })),
    };
  });
  const service: ImageIntakeService = {
    intake,
    intakeFolder: intake,
    reconcile: vi.fn(),
    reset: vi.fn(),
    snapshot: () => ({ count: 0, bytes: 0, sessionEpoch: 0 }),
  };
  const services: ImageWorkbenchServices = {
    createIntake: (nextOptions) => { options = nextOptions; return service; },
    createOcr: () => ({
      recognize: vi.fn(),
      cancelItem: vi.fn(),
      reset: vi.fn(),
      dispose: vi.fn(),
    }),
    createObjectUrls: () => objectUrls,
    buildPackage: vi.fn(async () => ({ ok: false, error: { code: "INVALID_SNAPSHOT", message: "Not used in this test." } } as const)),
    downloadPackage: vi.fn(() => ({ ok: false, message: "Not used in this test." } as const)),
    copyPrompt: vi.fn(async () => ({ ok: false, reason: "unavailable" } as const)),
    copyImage: vi.fn(async () => ({ ok: false, reason: "unavailable" } as const)),
  };
  return { services, created, revoked, live };
}

async function admitFixture(): Promise<void> {
  const input = new File([new Uint8Array([1])], "lease.png", { type: "image/png" });
  fireEvent.change(screen.getByLabelText("Add image files"), { target: { files: [input] } });
  await screen.findByRole("button", { name: "Focus lease-1.png" });
}

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("Image object URL custody", () => {
  it("enforces the hard 24-thumbnail fallback while retaining the focused image", () => {
    const ids = Array.from({ length: 30 }, (_, index) => `image-${index + 1}`);
    const result = updateImageThumbnailWindow({
      itemIds: ids,
      focusedId: "image-30",
      nearVisibleIds: [],
      previousRecency: [],
      observerAvailable: false,
    });
    expect(MAX_ACTIVE_IMAGE_THUMBNAILS).toBe(24);
    expect(result.activeIds).toHaveLength(24);
    expect(result.activeIds).toContain("image-30");
    expect(new Set(result.activeIds).size).toBe(24);
  });

  it("caps built package leases at 12 and the combined Image URL contract at 37", async () => {
    const keys = Array.from({ length: 100 }, (_, index) => `pair-${index + 1}`);
    expect(updateImagePackagePreviewWindow({
      pairKeys: keys,
      nearVisibleKeys: [],
      previousRecency: [],
      observerAvailable: false,
    }).activeKeys).toEqual(keys.slice(0, 12));
    expect(MAX_ACTIVE_IMAGE_THUMBNAILS + 1 + MAX_ACTIVE_IMAGE_PACKAGE_PREVIEWS).toBe(37);

    const harness = workbenchHarness();
    const pairs = keys.map((key, index) => ({
      occurrenceId: key,
      sourceHash: `${String(index).padStart(2, "0")}${"d".repeat(62)}`,
      key: `${String(index + 1).padStart(3, "0")}-pair`,
      displayName: `${key}.png`,
      sourceFilename: "source.png",
      sourceBytes: ownImageBytes(new Uint8Array([index]), "image/png"),
      mimeType: "image/png" as const,
      width: 1,
      height: 1,
      provenance: { ...provenance, sourceName: `${key}.png` },
      profileLabel: "OpenAI GPT Image",
      prompt: `prompt ${index}`,
      runCard: `run ${index}`,
      warnings: [],
    }));
    const view = render(<ImagePackagePreview
      pairs={pairs}
      objectUrls={harness.services.createObjectUrls()}
      leaseEnabled
      copyPrompt={harness.services.copyPrompt}
      copyImage={harness.services.copyImage}
    />);
    await waitFor(() => expect(harness.live.size).toBe(12));
    view.rerender(<ImagePackagePreview
      pairs={pairs}
      objectUrls={harness.services.createObjectUrls()}
      leaseEnabled={false}
      copyPrompt={harness.services.copyPrompt}
      copyImage={harness.services.copyImage}
    />);
    await waitFor(() => expect(harness.live.size).toBe(0));
  });

  it("promotes recently visible IDs and evicts the least-recent eligible lease", () => {
    const ids = Array.from({ length: 26 }, (_, index) => `image-${index + 1}`);
    const first = updateImageThumbnailWindow({
      itemIds: ids,
      focusedId: "image-1",
      nearVisibleIds: ids.slice(0, 24),
      previousRecency: [],
      observerAvailable: true,
    });
    const next = updateImageThumbnailWindow({
      itemIds: ids,
      focusedId: "image-1",
      nearVisibleIds: ["image-25"],
      previousRecency: first.recency,
      observerAvailable: true,
    });
    expect(next.activeIds).toContain("image-25");
    expect(next.activeIds).toContain("image-1");
    expect(next.activeIds).toHaveLength(24);
    expect(next.activeIds).not.toContain("image-2");
  });

  it("keeps the currently rendered StrictMode URL live and revokes it on disable/unmount", async () => {
    let sequence = 0;
    const revoke = vi.fn();
    const registry = new ImageObjectUrlRegistry(() => `blob:lease-${++sequence}`, revoke);
    const source = ownImageBytes(new Uint8Array([1]), "image/png");
    const Probe = ({ enabled, hash = "hash" }: { enabled: boolean; hash?: string }) => {
      const url = useImageObjectUrl(registry, {
        occurrenceId: "occ",
        sourceHash: hash,
        purpose: "thumbnail",
        sourceBytes: source,
        enabled,
      });
      return url ? <img alt="leased" src={url} /> : <p>disabled</p>;
    };
    const view = render(<StrictMode><Probe enabled /></StrictMode>);
    const live = (await screen.findByRole("img", { name: "leased" })).getAttribute("src");
    expect(live).toMatch(/^blob:lease-/u);
    expect(revoke).not.toHaveBeenCalledWith(live);

    view.rerender(<StrictMode><Probe enabled hash="replacement" /></StrictMode>);
    const replacement = (await screen.findByRole("img", { name: "leased" })).getAttribute("src");
    expect(replacement).not.toBe(live);
    expect(revoke).toHaveBeenCalledWith(live);
    expect(revoke).not.toHaveBeenCalledWith(replacement);

    view.rerender(<StrictMode><Probe enabled={false} /></StrictMode>);
    expect(await screen.findByText("disabled")).toBeInTheDocument();
    expect(revoke).toHaveBeenCalledWith(replacement);
    view.unmount();
  });

  it("defaults the desktop workbench to simultaneous thumbnail and focused leases", async () => {
    setViewport(1586);
    rememberTutorial();
    const harness = workbenchHarness();
    const view = render(<ImageWorkbench services={harness.services} />);

    await admitFixture();
    await waitFor(() => expect(harness.live.size).toBe(2));
    expect(screen.getByRole("region", { name: "Image queue" }).querySelector("img")).not.toBeNull();
    expect(screen.getByRole("img", { name: "Focused source lease-1.png" })).toBeInTheDocument();

    view.unmount();
    expect(harness.live.size).toBe(0);
    expect(new Set(harness.revoked)).toEqual(new Set(harness.created));
  });

  it("opens tablet Settings in a drawer and restores focus to its trigger on close", async () => {
    setViewport(1024);
    rememberTutorial();
    const harness = workbenchHarness();
    render(<ImageWorkbench services={harness.services} />);
    const trigger = screen.getByRole("button", { name: "Settings" });

    trigger.focus();
    fireEvent.click(trigger);
    const drawer = screen.getByRole("dialog", { name: /image settings/iu });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(drawer).toHaveClass("settings-drawer");

    fireEvent.keyDown(drawer, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /image settings/iu })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("dismisses the tablet drawer on mode change without reopening and scopes aria-expanded to tablet", async () => {
    const viewport = installResponsiveViewport(1024);
    rememberTutorial();
    const harness = workbenchHarness();
    render(<ImageWorkbench services={harness.services} />);
    const trigger = screen.getByRole("button", { name: "Settings" });

    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: /image settings/iu })).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    act(() => viewport.resize(1586));
    expect(screen.queryByRole("dialog", { name: /image settings/iu })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).not.toHaveAttribute("aria-expanded");

    act(() => viewport.resize(1024));
    expect(screen.queryByRole("dialog", { name: /image settings/iu })).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("leases only the active mobile panel and revokes on switching and reset", async () => {
    setViewport(390);
    rememberTutorial();
    const harness = workbenchHarness();
    render(<ImageWorkbench services={harness.services} />);

    await admitFixture();
    const queue = screen.getByRole("region", { name: "Image queue" });
    const preview = screen.getByRole("region", { name: "Focused image preview" });
    await waitFor(() => expect(harness.live.size).toBe(1));
    expect(queue.querySelector("img")).not.toBeNull();
    expect(preview.querySelector("img")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "PREVIEW" }));
    await waitFor(() => expect(screen.getByRole("img", { name: "Focused source lease-1.png" })).toBeInTheDocument());
    expect(queue.querySelector("img")).toBeNull();
    expect(harness.live.size).toBe(1);

    fireEvent.click(screen.getByRole("tab", { name: "SETTINGS" }));
    await waitFor(() => expect(harness.live.size).toBe(0));
    expect(preview.querySelector("img")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "IMAGES" }));
    await waitFor(() => expect(harness.live.size).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Start a new Image session?" }))
      .getByRole("button", { name: "CLEAR IMAGE SESSION" }));
    await waitFor(() => expect(harness.live.size).toBe(0));
    expect(new Set(harness.revoked)).toEqual(new Set(harness.created));
  });

  it("revokes the active mobile lease when the workbench unmounts", async () => {
    setViewport(390);
    rememberTutorial();
    const harness = workbenchHarness();
    const view = render(<ImageWorkbench services={harness.services} />);

    await admitFixture();
    await waitFor(() => expect(harness.live.size).toBe(1));
    view.unmount();

    expect(harness.live.size).toBe(0);
    expect(new Set(harness.revoked)).toEqual(new Set(harness.created));
  });
});
