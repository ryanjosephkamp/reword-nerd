import { useEffect, useRef, useState } from "react";
import "../../../styles/guided-help.css";
import {
  DEMO_DEFINITIONS,
  resolveDemoAssetPath,
  type DemoVideoId,
} from "./demoVideoData";

export type { DemoVideoId } from "./demoVideoData";

function useReducedMotion(videoRef: React.RefObject<HTMLVideoElement | null>): boolean {
  const [reduced, setReduced] = useState(() => (
    typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ));

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = (event: MediaQueryListEvent) => {
      if (event.matches && videoRef.current) {
        videoRef.current.pause();
        videoRef.current.currentTime = 0;
      }
      setReduced(event.matches);
    };
    preference.addEventListener("change", change);
    return () => preference.removeEventListener("change", change);
  }, [videoRef]);

  return reduced;
}

export function DemoVideo({ demo, className = "" }: { demo: DemoVideoId; className?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const definition = DEMO_DEFINITIONS[demo];
  const reducedMotion = useReducedMotion(videoRef);
  const poster = resolveDemoAssetPath(`${demo}-poster.webp`);

  useEffect(() => () => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = 0;
  }, []);

  return <figure className={`demo-video${className ? ` ${className}` : ""}`}>
    <div className="demo-video-frame">
      {reducedMotion
        ? <img src={poster} alt={definition.posterAlt} />
        : <video
          ref={videoRef}
          aria-label={definition.accessibleLabel}
          controls
          muted
          playsInline
          preload="none"
          poster={poster}
        >
          <source src={resolveDemoAssetPath(`${demo}.webm`)} type="video/webm" />
          <source src={resolveDemoAssetPath(`${demo}.mp4`)} type="video/mp4" />
          Your browser cannot play this local demonstration video.
        </video>}
    </div>
    <figcaption>
      <strong>{definition.title}</strong>
      <span>Silent, synthetic product demonstration.</span>
    </figcaption>
    <p className="demo-video-fallback">
      Video unavailable? <a href={poster}>Open the demonstration poster</a>.
    </p>
    <details className="demo-transcript">
      <summary>Read transcript</summary>
      <ol>{definition.transcript.map((line) => <li key={line}>{line}</li>)}</ol>
    </details>
  </figure>;
}
