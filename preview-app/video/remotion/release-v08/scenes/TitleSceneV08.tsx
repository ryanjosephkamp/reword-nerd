import { Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { colors } from "../../components/theme";
import type { ReleaseUpdateV08Props } from "../ReleaseUpdateV08.contract";
import { ReleaseV08Shell } from "../components/ReleaseV08Shell";

export function TitleSceneV08({ title, subtitle }: ReleaseUpdateV08Props) {
  const frame = useCurrentFrame();
  return <ReleaseV08Shell durationInFrames={132} eyebrow="ADDED" scene="01">
    <div style={{ display: "grid", gridTemplateColumns: "260px minmax(0,1fr)", gap: 62, alignItems: "center", height: "calc(100% - 58px)" }}>
      <div style={{ position: "relative", display: "grid", placeItems: "center", opacity: interpolate(frame, [8, 34], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), scale: interpolate(frame, [8, 34], [0.9, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) }) }}>
        <div style={{ position: "absolute", width: 238, height: 238, border: `1px solid ${colors.orange}`, rotate: "8deg", opacity: 0.28 }} />
        <Img src={staticFile("image/orange-pyramid.webp")} style={{ width: 210, height: 210, objectFit: "cover", borderRadius: 42, boxShadow: "0 26px 70px rgba(0,0,0,.5)" }} />
      </div>
      <div style={{ opacity: interpolate(frame, [18, 44], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) }), translate: `0 ${interpolate(frame, [18, 44], [30, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px` }}>
        <div style={{ color: colors.orange, fontSize: 22, letterSpacing: 3 }}>IMAGE PORTAL</div>
        <h1 style={{ margin: "17px 0 0", fontSize: 76, lineHeight: 1.02, letterSpacing: -4 }}>{title}</h1>
        <p style={{ maxWidth: 770, margin: "25px 0 0", color: colors.muted, fontSize: 25, lineHeight: 1.42 }}>{subtitle}</p>
      </div>
    </div>
  </ReleaseV08Shell>;
}
