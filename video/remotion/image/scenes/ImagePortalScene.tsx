import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { colors, mono } from "../../components/theme";

export function ImagePortalScene({ outro = false }: { readonly outro?: boolean }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) });
  return <AbsoluteFill style={{ display: "grid", placeItems: "center", background: colors.canvas, color: colors.text, fontFamily: mono }}>
    <div style={{ display: "grid", justifyItems: "center", maxWidth: 1000, textAlign: "center", opacity, transform: `translateY(${interpolate(frame, [0, 24], [24, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px)` }}>
      <Img src={staticFile("image/orange-pyramid.webp")} style={{ width: 154, height: 154, objectFit: "cover", borderRadius: 34, marginBottom: 24 }} />
      <div style={{ color: colors.orange, fontSize: 25, marginBottom: 17 }}>reword_nerd/ IMAGE</div>
      <div style={{ fontSize: outro ? 56 : 64, fontWeight: 700, lineHeight: 1.08 }}>{outro ? "Your images stay local." : "Build one faithful prompt package per image."}</div>
      <div style={{ maxWidth: 880, marginTop: 21, color: colors.muted, fontSize: 25, lineHeight: 1.4 }}>{outro ? "No model runs. Nothing uploads. Download only when you choose." : "Add sources, apply shared settings, review locally, then build one inspectable ZIP."}</div>
      {!outro && <div style={{ display: "flex", gap: 18, marginTop: 30, fontSize: 18 }}><span style={{ color: colors.mint }}>TEXT</span><span style={{ color: colors.orange, borderBottom: `2px solid ${colors.orange}`, paddingBottom: 7 }}>IMAGE</span></div>}
    </div>
  </AbsoluteFill>;
}
