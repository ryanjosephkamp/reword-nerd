import { act, fireEvent, render, screen } from "@testing-library/react";
import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { DemoVideo } from "../../src/app/workbench/components/DemoVideo";
import { resolveDemoAssetPath } from "../../src/app/workbench/components/demoVideoData";

function installMotionPreference(reduced: boolean) {
  let matches = reduced;
  const listeners = new Set<EventListener>();
  const query = {
    get matches() { return matches; },
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === "function") listeners.add(listener);
    }),
    removeEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === "function") listeners.delete(listener);
    }),
    dispatchEvent: vi.fn(),
  } as MediaQueryList;
  vi.stubGlobal("matchMedia", vi.fn(() => query));
  return {
    reduce() {
      matches = true;
      listeners.forEach((listener) => listener.call(query, { matches: true } as MediaQueryListEvent));
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("DemoVideo", () => {
  it("keeps every rendered demo and the aggregate payload within the release budget", () => {
    const directory = resolve(process.cwd(), "public/media/demo");
    const bytes = (filename: string) => statSync(resolve(directory, filename)).size;
    expect(bytes("overview.webm")).toBeLessThanOrEqual(1.8 * 1024 * 1024);
    expect(bytes("overview.mp4")).toBeLessThanOrEqual(2.5 * 1024 * 1024);
    for (const chapter of ["settings", "review", "package"]) {
      expect(bytes(`${chapter}.webm`)).toBeLessThanOrEqual(650 * 1024);
      expect(bytes(`${chapter}.mp4`)).toBeLessThanOrEqual(900 * 1024);
    }
    expect(bytes("image-overview.webm")).toBeLessThanOrEqual(1.8 * 1024 * 1024);
    expect(bytes("image-overview.mp4")).toBeLessThanOrEqual(2.5 * 1024 * 1024);
    expect(bytes("image-overview-poster.webp")).toBeLessThanOrEqual(100 * 1024);
    const aggregate = readdirSync(directory).reduce((total, filename) => total + bytes(filename), 0);
    expect(aggregate).toBeLessThanOrEqual(12 * 1024 * 1024);
  });

  it("resolves local demo media under the configured deployment base", () => {
    expect(resolveDemoAssetPath("overview.webm", "/reword-nerd/")).toBe(
      "/reword-nerd/media/demo/overview.webm",
    );
    expect(resolveDemoAssetPath("overview.webm", "/")).toBe("/media/demo/overview.webm");
  });

  it("uses quiet native playback with local WebM and H.264 fallbacks", () => {
    installMotionPreference(false);
    const { container } = render(<DemoVideo demo="overview" />);

    const video = screen.getByLabelText("reword_nerd overview demonstration") as HTMLVideoElement;
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("playsinline");
    expect(video).toHaveAttribute("preload", "none");
    expect(video.autoplay).toBe(false);
    expect(video.muted).toBe(true);
    expect(video.poster).toMatch(/\/media\/demo\/overview-poster\.webp$/u);
    expect(Array.from(container.querySelectorAll("source")).map((source) => ({
      src: source.getAttribute("src"),
      type: source.getAttribute("type"),
    }))).toEqual([
      { src: "/media/demo/overview.webm", type: "video/webm" },
      { src: "/media/demo/overview.mp4", type: "video/mp4" },
    ]);
    expect(screen.getByText(/Choose the model profile and rewrite settings/u)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the demonstration poster" })).toHaveAttribute(
      "href",
      "/media/demo/overview-poster.webp",
    );
  });

  it("uses a distinct orange Image Quick Start walkthrough with local fallbacks and a complete transcript", () => {
    // Removing the dedicated Image tutorial or accidentally reusing the Text overview must make this fail.
    installMotionPreference(false);
    const { container } = render(<DemoVideo demo={"image-overview" as never} />);

    const video = screen.getByLabelText("reword_nerd Image Quick Start demonstration") as HTMLVideoElement;
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("playsinline");
    expect(video).toHaveAttribute("preload", "none");
    expect(video.muted).toBe(true);
    expect(video.poster).toMatch(/\/media\/demo\/image-overview-poster\.webp$/u);
    expect(Array.from(container.querySelectorAll("source")).map((source) => ({
      src: source.getAttribute("src"),
      type: source.getAttribute("type"),
    }))).toEqual([
      { src: "/media/demo/image-overview.webm", type: "video/webm" },
      { src: "/media/demo/image-overview.mp4", type: "video/mp4" },
    ]);
    for (const guidance of [
      "Add images or a folder",
      "Click or activate an image card to focus it",
      "Apply shared settings to selected images",
      "Review warnings and optional local OCR",
      "Build the confirmed package in memory",
      "Download the timestamped ZIP",
      "No model runs and nothing uploads",
    ]) expect(screen.getByText(new RegExp(guidance, "iu"))).toBeInTheDocument();
  });

  it("shows the poster and complete transcript instead of motion when reduced motion is requested", () => {
    installMotionPreference(true);
    render(<DemoVideo demo="settings" />);

    expect(screen.queryByLabelText("Settings demonstration")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Settings demonstration poster" })).toHaveAttribute(
      "src",
      "/media/demo/settings-poster.webp",
    );
    expect(screen.getByText(/Context limit powers the package-size warning/u)).toBeInTheDocument();
  });

  it("pauses and resets active playback when motion preference changes", () => {
    const preference = installMotionPreference(false);
    render(<DemoVideo demo="review" />);
    const video = screen.getByLabelText("Review demonstration") as HTMLVideoElement;
    const pause = vi.spyOn(video, "pause").mockImplementation(() => undefined);
    Object.defineProperty(video, "currentTime", { configurable: true, writable: true, value: 9 });

    fireEvent.play(video);
    act(() => preference.reduce());

    expect(pause).toHaveBeenCalled();
    expect(video.currentTime).toBe(0);
    expect(screen.getByRole("img", { name: "Review demonstration poster" })).toBeInTheDocument();
  });
});
