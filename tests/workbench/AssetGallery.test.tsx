import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode, useState } from "react";
import type { VisualAsset } from "../../src/domain";
import { AssetGallery } from "../../src/app/workbench/components/AssetGallery";

function asset(id: string, order: number, included = true): VisualAsset {
  return {
    id,
    order,
    kind: "pdf-raster",
    filename: `${id}.bin`,
    mimeType: "application/octet-stream",
    bytes: new Uint8Array([order]),
    byteCount: 1,
    sha256: `hash-${id}`,
    pageNumber: order,
    caption: `Figure ${order}`,
    included,
    decorative: false,
    warnings: [],
  };
}

function GalleryHarness({ assets, onInclusionChange = () => undefined }: {
  assets: readonly VisualAsset[];
  onInclusionChange?(assetId: string, included: boolean): void;
}) {
  const [view, setView] = useState<"detail" | "gallery">("detail");
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(assets[0]?.id ?? null);
  return <AssetGallery
    assets={assets}
    view={view}
    selectedAssetId={selectedAssetId}
    onViewChange={setView}
    onSelect={setSelectedAssetId}
    onInclusionChange={onInclusionChange}
  />;
}

describe("AssetGallery", () => {
  it("switches between one-at-a-time review and a selectable gallery without losing inclusion controls", () => {
    const onInclusionChange = vi.fn();
    render(<GalleryHarness
      assets={[asset("asset-1", 1), asset("asset-2", 2), asset("asset-3", 3, false)]}
      onInclusionChange={onInclusionChange}
    />);

    expect(screen.getByRole("button", { name: "DETAIL" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Figure 1" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Figure 2" })).not.toBeInTheDocument();
    expect(screen.getByText("1 / 3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "GALLERY" }));
    const gallery = screen.getByRole("list", { name: "Visual asset gallery" });
    expect(within(gallery).getAllByRole("listitem")).toHaveLength(3);
    expect(within(gallery).getByRole("button", { name: "Select Figure 1, included" })).toHaveAttribute("aria-pressed", "true");
    expect(within(gallery).getByRole("button", { name: "Select Figure 3, omitted" })).toBeVisible();

    fireEvent.click(within(gallery).getByRole("button", { name: "Select Figure 3, omitted" }));
    expect(within(gallery).getByRole("button", { name: "Select Figure 3, omitted" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "DETAIL" }));

    expect(screen.getByRole("heading", { name: "Figure 3" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Figure 1" })).not.toBeInTheDocument();
    expect(screen.getByText("3 / 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Include Figure 3" }));
    expect(onInclusionChange).toHaveBeenCalledWith("asset-3", true);
  });

  it("moves through detail items while preserving an accessible selected state", () => {
    render(<GalleryHarness assets={[asset("asset-1", 1), asset("asset-2", 2)]} />);

    const previous = screen.getByRole("button", { name: "Previous visual asset" });
    const next = screen.getByRole("button", { name: "Next visual asset" });
    expect(previous).toBeDisabled();
    expect(next).toBeEnabled();
    fireEvent.click(next);
    expect(screen.getByRole("heading", { name: "Figure 2" })).toBeInTheDocument();
    expect(previous).toBeEnabled();
    expect(next).toBeDisabled();
  });

  it("defers grid object URLs until thumbnails approach the viewport", () => {
    const callbacks: IntersectionObserverCallback[] = [];
    const originalObserver = globalThis.IntersectionObserver;
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      value: class {
        constructor(callback: IntersectionObserverCallback) { callbacks.push(callback); }
        observe() { /* controlled below */ }
        unobserve() { /* no-op */ }
        disconnect() { /* no-op */ }
        takeRecords() { return []; }
        root = null;
        rootMargin = "160px";
        thresholds = [0];
      },
    });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:asset") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    const images = [asset("asset-1", 1), asset("asset-2", 2)];
    images.forEach((item) => { item.mimeType = "image/png"; });
    render(<GalleryHarness assets={images} />);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "GALLERY" }));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    act(() => callbacks.forEach((callback) => callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(3);

    Object.defineProperty(globalThis, "IntersectionObserver", { configurable: true, value: originalObserver });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: originalCreate });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: originalRevoke });
  });

  it("keeps thumbnail object URLs alive through the development StrictMode effect replay", () => {
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    let created = 0;
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => `blob:strict-asset-${++created}`) });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    const image = asset("asset-1", 1);
    image.mimeType = "image/png";

    const rendered = render(<StrictMode><GalleryHarness assets={[image]} /></StrictMode>);
    const activeUrl = screen.getByRole("img", { name: "Figure 1" }).getAttribute("src");
    expect(activeUrl).toMatch(/^blob:strict-asset-/u);
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(activeUrl);
    rendered.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(activeUrl);

    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: originalCreate });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: originalRevoke });
  });
});
