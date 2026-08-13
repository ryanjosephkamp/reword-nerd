import { Easing, interpolate, useCurrentFrame } from "remotion";
import type { ReleaseUpdateProps } from "../ReleaseUpdate.contract";
import { ReleaseSceneShell } from "../components/ReleaseSceneShell";
import { colors } from "../../components/theme";

export function ContextScene({ context, version }: ReleaseUpdateProps) {
  const frame = useCurrentFrame();
  return <ReleaseSceneShell label={`WHY v${version}`} scene="02">
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.25fr) minmax(340px,.75fr)", gap: 52, alignItems: "center", height: "calc(100% - 48px)" }}>
      <div style={{ opacity: interpolate(frame, [8, 30], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) }), translate: `0 ${interpolate(frame, [8, 30], [22, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px` }}>
        <h2 style={{ margin: 0, fontSize: 60, lineHeight: 1.1, letterSpacing: -2 }}>Release context should be easy to find.</h2>
        <p style={{ margin: "26px 0 0", color: colors.muted, fontSize: 27, lineHeight: 1.45 }}>{context}</p>
      </div>
      <div style={{ display: "grid", gap: 12, padding: 24, border: `1px solid ${colors.border}`, background: colors.surface, opacity: interpolate(frame, [28, 54], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), scale: interpolate(frame, [28, 54], [0.94, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) }) }}>
        <div style={{ color: colors.mint, fontSize: 17, letterSpacing: 1.8 }}>RELEASE LEDGER</div>
        {["Version / 0.7.0", "Status / current", "Media / same-origin", "Privacy / local-first"].map((line, index) => <div key={line} style={{ padding: "14px 0", borderTop: `1px solid ${colors.border}`, color: index === 2 ? colors.mint : colors.text, fontSize: 21, opacity: interpolate(frame, [44 + index * 10, 60 + index * 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>{line}</div>)}
      </div>
    </div>
  </ReleaseSceneShell>;
}
