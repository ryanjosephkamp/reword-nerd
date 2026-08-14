import { Easing, interpolate, useCurrentFrame } from "remotion";
import { colors } from "../../components/theme";
import type { ReleaseUpdateV08Props } from "../ReleaseUpdateV08.contract";
import { ReleaseV08Shell } from "../components/ReleaseV08Shell";

export function PrivacySceneV08({ closingLine }: ReleaseUpdateV08Props) {
  const frame = useCurrentFrame();
  return <ReleaseV08Shell durationInFrames={132} eyebrow="LOCAL BY DESIGN" scene="05">
    <div style={{ display: "grid", placeItems: "center", height: "calc(100% - 58px)", textAlign: "center" }}>
      <div style={{ maxWidth: 1020 }}>
        <div style={{ color: colors.orange, fontSize: 20, letterSpacing: 3, opacity: interpolate(frame, [7, 25], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>TEXT + IMAGE</div>
        <h2 style={{ margin: "19px 0 0", fontSize: 68, lineHeight: 1.07, letterSpacing: -3, opacity: interpolate(frame, [15, 40], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) }), translate: `0 ${interpolate(frame, [15, 40], [28, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px` }}>Files stay in the browser.</h2>
        <p style={{ margin: "25px 0 0", color: colors.muted, fontSize: 26, lineHeight: 1.4, opacity: interpolate(frame, [34, 58], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>{closingLine}</p>
        <div style={{ display: "flex", justifyContent: "center", gap: 13, marginTop: 38 }}>{["NO CREDENTIALS", "NO PROVIDER CALLS", "DELIBERATE DOWNLOAD"].map((label, index) => <span key={label} style={{ padding: "13px 17px", border: `1px solid ${index === 2 ? colors.orange : colors.border}`, color: index === 2 ? colors.orange : colors.text, fontSize: 15, opacity: interpolate(frame, [52 + index * 10, 68 + index * 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>{label}</span>)}</div>
      </div>
    </div>
  </ReleaseV08Shell>;
}
