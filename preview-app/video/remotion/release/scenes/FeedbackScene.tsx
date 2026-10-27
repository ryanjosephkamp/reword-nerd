import { Easing, interpolate, useCurrentFrame } from "remotion";
import type { ReleaseUpdateProps } from "../ReleaseUpdate.contract";
import { ReleaseSceneShell } from "../components/ReleaseSceneShell";
import { colors } from "../../components/theme";

export function FeedbackScene({ feedback }: ReleaseUpdateProps) {
  const frame = useCurrentFrame();
  return <ReleaseSceneShell label="KEEP THE LOOP OPEN" scene="05">
    <div style={{ display: "grid", height: "calc(100% - 48px)", alignContent: "center", justifyItems: "center", textAlign: "center" }}>
      <h2 style={{ maxWidth: 1040, margin: 0, fontSize: 66, lineHeight: 1.08, letterSpacing: -3, opacity: interpolate(frame, [8, 30], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) }) }}>Find the release. Send useful feedback. Share the clean URL.</h2>
      <div style={{ display: "flex", justifyContent: "center", gap: 14, marginTop: 40 }}>{[feedback.bugLabel, feedback.featureLabel, feedback.shareLabel].map((label, index) => <div key={label} style={{ padding: "15px 20px", border: `1px solid ${index === 2 ? colors.mint : colors.border}`, color: index === 2 ? colors.mint : colors.text, fontSize: 18, opacity: interpolate(frame, [34 + index * 11, 50 + index * 11], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), scale: interpolate(frame, [34 + index * 11, 50 + index * 11], [0.92, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) }) }}>{label}</div>)}</div>
      <p style={{ margin: "38px 0 0", color: colors.muted, fontSize: 26, opacity: interpolate(frame, [68, 92], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>{feedback.closingLine}</p>
    </div>
  </ReleaseSceneShell>;
}
