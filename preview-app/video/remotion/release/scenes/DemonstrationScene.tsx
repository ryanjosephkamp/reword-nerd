import { Easing, interpolate, useCurrentFrame } from "remotion";
import type { ReleaseUpdateProps } from "../ReleaseUpdate.contract";
import { ReleaseSceneShell } from "../components/ReleaseSceneShell";
import { colors } from "../../components/theme";

export function DemonstrationScene({ demonstrationLabel, feedback, version }: ReleaseUpdateProps) {
  const frame = useCurrentFrame();
  const reveal = (start: number) => ({ opacity: interpolate(frame, [start, start + 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) }), translate: `0 ${interpolate(frame, [start, start + 14], [16, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px` });
  return <ReleaseSceneShell label={demonstrationLabel.toUpperCase()} scene="03">
    <div style={{ display: "grid", gridTemplateColumns: "190px minmax(0,1fr)", height: "calc(100% - 48px)", marginTop: 28, border: `1px solid ${colors.border}`, background: colors.surface, overflow: "hidden" }}>
      <aside style={{ padding: 21, borderRight: `1px solid ${colors.border}`, color: colors.muted, fontSize: 17 }}>
        <div style={{ color: colors.text, fontWeight: 700, fontSize: 20 }}>reword-nerd</div>
        <div style={{ marginTop: 38, color: colors.mint, ...reveal(10) }}>↳ Updates</div>
        <div style={{ marginTop: 23, ...reveal(22) }}>Workbench</div>
        <div style={{ marginTop: 23, ...reveal(34) }}>Help</div>
        <div style={{ marginTop: 23, ...reveal(46) }}>Info</div>
      </aside>
      <div style={{ padding: "26px 30px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, ...reveal(6) }}><div><div style={{ color: colors.mint, fontSize: 16, letterSpacing: 1.5 }}>BUILDER'S JOURNAL</div><div style={{ marginTop: 8, fontSize: 38, fontWeight: 700 }}>Updates</div></div><div style={{ padding: "12px 16px", color: colors.mint, border: `1px solid ${colors.mint}`, fontSize: 16, fontWeight: 700 }}>↗ {feedback.shareLabel}</div></div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 278px", gap: 20, marginTop: 26 }}>
          <div style={{ display: "grid", gap: 12 }}>
            {[`reword-nerd v${version}`, "Road to v0.6"].map((title, index) => <div key={title} style={{ padding: "19px 20px", border: `1px solid ${index === 0 ? colors.mint : colors.border}`, background: index === 0 ? "#10201e" : colors.raised, ...reveal(22 + index * 18) }}><div style={{ color: colors.muted, fontSize: 14 }}>{index === 0 ? "CURRENT RELEASE" : "RETROSPECTIVE"}</div><div style={{ marginTop: 8, fontSize: 25, color: index === 0 ? colors.mint : colors.text }}>{title}</div></div>)}
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            {[feedback.bugLabel, feedback.featureLabel].map((label, index) => <div key={label} style={{ display: "grid", placeItems: "center", minHeight: 76, padding: 12, border: `1px solid ${colors.border}`, color: colors.text, fontSize: 17, textAlign: "center", ...reveal(58 + index * 18) }}>{label}</div>)}
          </div>
        </div>
      </div>
    </div>
  </ReleaseSceneShell>;
}
