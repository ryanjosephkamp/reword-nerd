import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { colors, mono } from "../components/theme";

export function IntroScene({ outro = false }: { outro?: boolean }) {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{ display: "grid", placeItems: "center", background: colors.canvas, color: colors.text, fontFamily: mono }}>
    <div style={{ display: "grid", justifyItems: "center", textAlign: "center", opacity: interpolate(frame, [0, 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) }), translate: `0 ${interpolate(frame, [0, 24], [28, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px` }}>
      <Img src={staticFile("brand/reword-nerd-logo.webp")} style={{ width: 180, height: 180, borderRadius: 38, marginBottom: 28 }} />
      <div style={{ color: colors.mint, fontSize: 26, marginBottom: 20 }}>reword_nerd/</div>
      <div style={{ maxWidth: 970, fontSize: outro ? 62 : 72, fontWeight: 700, lineHeight: 1.08 }}>{outro ? "Your source. Your model. Your workflow." : "Build inspectable rewrite prompt packages."}</div>
      <div style={{ maxWidth: 840, marginTop: 24, color: colors.muted, fontSize: 27, lineHeight: 1.35 }}>{outro ? "Everything is generated locally in your browser." : "Choose settings, review extraction, then use One-shot or four-stage Manual prompts."}</div>
    </div>
  </AbsoluteFill>;
}
