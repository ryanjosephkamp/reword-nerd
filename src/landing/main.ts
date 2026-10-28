import "../styles/base.css";
import "./landing.css";
import { mountAppearanceMenu } from "../shared/appearance";

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-appearance]")) {
  mountAppearanceMenu(button);
}

// The demo loads only when it scrolls into view, and plays only for people who allow motion.
const video = document.querySelector<HTMLVideoElement>(".demo-video");
if (video) {
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const load = () => {
    for (const [attribute, type] of [
      ["srcWebm", "video/webm"],
      ["srcMp4", "video/mp4"],
    ] as const) {
      const source = document.createElement("source");
      source.src = video.dataset[attribute] ?? "";
      source.type = type;
      video.append(source);
    }
    video.load();
    if (still) video.controls = true;
    else void video.play().catch(() => (video.controls = true));
  };
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          load();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(video);
  } else {
    load();
  }
}
