import { Easing, interpolate, useCurrentFrame } from "remotion";
import type { ReleaseUpdateProps } from "../ReleaseUpdate.contract";
import { ReleaseSceneShell } from "../components/ReleaseSceneShell";
import { colors } from "../../components/theme";

export function TitleScene({ title, version }: ReleaseUpdateProps) {
  const frame = useCurrentFrame();
  return <ReleaseSceneShell label={`REWORD_NERD v${version}`} scene="01">
    <div style={{ display: "grid", height: "calc(100% - 48px)", alignContent: "center", maxWidth: 1010 }}>
      <p style={{ margin: 0, color: colors.mint, fontSize: 26, letterSpacing: 3, opacity: interpolate(frame, [8, 28], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) }) }}>RELEASE NOTE</p>
      <h1 style={{ margin: "20px 0 0", fontSize: 84, lineHeight: 1.02, letterSpacing: -4, opacity: interpolate(frame, [16, 42], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) }), translate: `0 ${interpolate(frame, [16, 42], [36, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) })}px` }}>{title}</h1>
      <p style={{ maxWidth: 720, margin: "30px 0 0", color: colors.muted, fontSize: 30, lineHeight: 1.35, opacity: interpolate(frame, [34, 60], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>A quiet, local-first release walkthrough.</p>
      <div style={{ display: "flex", gap: 11, marginTop: 48 }}>{[0, 1, 2, 3, 4].map((index) => <i key={index} style={{ display: "block", width: index === 0 ? 106 : 30, height: 5, background: index === 0 ? colors.mint : colors.border, opacity: interpolate(frame, [48 + index * 8, 62 + index * 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }} />)}</div>
    </div>
  </ReleaseSceneShell>;
}
