import { Easing, interpolate, useCurrentFrame } from "remotion";
import { colors } from "../../components/theme";
import { ReleaseV08Shell } from "../components/ReleaseV08Shell";

const steps = [
  ["01", "ADD", "Safe local intake"],
  ["02", "CONFIGURE", "Per-image or selected"],
  ["03", "REVIEW", "Warnings + optional OCR"],
  ["04", "CONFIRM", "Freeze the image set"],
  ["05", "BUILD", "Deterministic package"],
  ["06", "DOWNLOAD", "Timestamped ZIP"],
] as const;

export function LocalWorkflowSceneV08() {
  const frame = useCurrentFrame();
  return <ReleaseV08Shell durationInFrames={162} eyebrow="LOCAL PIPELINE" scene="03">
    <div style={{ display: "grid", alignContent: "center", height: "calc(100% - 58px)" }}>
      <h2 style={{ margin: 0, fontSize: 53, letterSpacing: -2 }}>From source image to inspectable package.</h2>
      <p style={{ margin: "15px 0 0", color: colors.muted, fontSize: 22 }}>Each prompt stays paired with exactly one source image and its reviewed settings.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 15, marginTop: 31 }}>
        {steps.map(([number, label, detail], index) => <div key={label} style={{ minHeight: 125, padding: 18, border: `1px solid ${index === Math.min(5, Math.floor(frame / 25)) ? colors.orange : colors.border}`, background: index === Math.min(5, Math.floor(frame / 25)) ? "#1d160d" : colors.surface, opacity: interpolate(frame, [8 + index * 12, 25 + index * 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) }), translate: `0 ${interpolate(frame, [8 + index * 12, 25 + index * 12], [20, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px` }}><span style={{ color: colors.orange, fontSize: 14 }}>{number}</span><strong style={{ display: "block", marginTop: 13, fontSize: 21 }}>{label}</strong><span style={{ display: "block", marginTop: 8, color: colors.muted, fontSize: 14 }}>{detail}</span></div>)}
      </div>
      <div style={{ marginTop: 24, padding: "14px 18px", borderLeft: `4px solid ${colors.orange}`, background: colors.raised, color: colors.text, fontSize: 17 }}>BUILD creates the ZIP in memory. DOWNLOAD remains a separate deliberate action.</div>
    </div>
  </ReleaseV08Shell>;
}
