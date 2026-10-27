import { Easing, interpolate, useCurrentFrame } from "remotion";
import type { ReleaseUpdateProps } from "../ReleaseUpdate.contract";
import { ReleaseSceneShell } from "../components/ReleaseSceneShell";
import { colors } from "../../components/theme";

export function HighlightsScene({ highlights }: ReleaseUpdateProps) {
  const frame = useCurrentFrame();
  return <ReleaseSceneShell label="WHAT CHANGED" scene="04">
    <div style={{ display: "grid", height: "calc(100% - 48px)", alignContent: "center" }}>
      <h2 style={{ margin: 0, fontSize: 57, letterSpacing: -2 }}>Three focused additions.</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 18, marginTop: 38 }}>
        {highlights.map((highlight, index) => <div key={highlight} style={{ minHeight: 190, padding: 24, border: `1px solid ${index === 0 ? colors.mint : colors.border}`, background: index === 0 ? "#10201e" : colors.surface, opacity: interpolate(frame, [12 + index * 15, 34 + index * 15], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) }), translate: `0 ${interpolate(frame, [12 + index * 15, 34 + index * 15], [26, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px` }}><div style={{ color: colors.mint, fontSize: 18 }}>0{index + 1}</div><p style={{ margin: "28px 0 0", fontSize: 27, lineHeight: 1.25 }}>{highlight}</p></div>)}
      </div>
    </div>
  </ReleaseSceneShell>;
}
