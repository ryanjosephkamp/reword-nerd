import { Easing, interpolate, useCurrentFrame } from "remotion";
import { colors } from "../../components/theme";
import { ReleaseV08Shell } from "../components/ReleaseV08Shell";

const queue = ["pyramid.webp", "dashboard.png", "poster.webp"];

export function ImagePortalSceneV08() {
  const frame = useCurrentFrame();
  const reveal = (start: number) => ({ opacity: interpolate(frame, [start, start + 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) }), translate: `0 ${interpolate(frame, [start, start + 18], [18, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px` });
  return <ReleaseV08Shell durationInFrames={144} eyebrow="IMAGE WORKBENCH" scene="02">
    <div style={{ marginTop: 24, height: 520, border: `1px solid ${colors.orange}`, background: colors.surface, boxShadow: "0 22px 56px rgba(0,0,0,.35)", ...reveal(4) }}>
      <div style={{ height: 50, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 18px", borderBottom: `1px solid ${colors.border}` }}>
        <div style={{ display: "flex", gap: 18, alignItems: "center" }}><strong style={{ color: colors.orange }}>reword_nerd/</strong><span style={{ color: colors.mint, fontSize: 13 }}>TEXT</span><span style={{ color: colors.orange, paddingBottom: 5, borderBottom: `2px solid ${colors.orange}`, fontSize: 13 }}>IMAGE</span></div>
        <span style={{ color: colors.muted, fontSize: 13 }}>LOCAL SESSION · FILES STAY HERE</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "258px minmax(0,1fr) 300px", height: 468 }}>
        <section style={{ padding: 16, borderRight: `1px solid ${colors.border}`, ...reveal(18) }}><div style={{ color: colors.orange, fontSize: 12, letterSpacing: 1.6 }}>IMAGE SET</div><h2 style={{ margin: "7px 0 15px", fontSize: 26 }}>IMAGES</h2>{queue.map((name, index) => <div key={name} style={{ display: "grid", gridTemplateColumns: "45px 1fr", gap: 10, padding: 10, marginTop: 9, border: `1px solid ${index === 0 ? colors.orange : colors.border}`, background: index === 0 ? "#1b150e" : colors.canvas, ...reveal(26 + index * 10) }}><div style={{ width: 45, height: 36, background: index === 0 ? "linear-gradient(135deg,#282832,#ff9f1c)" : `linear-gradient(135deg,${colors.raised},${colors.border})` }} /><div><strong style={{ display: "block", fontSize: 11 }}>{name}</strong><span style={{ color: colors.muted, fontSize: 9 }}>INCLUDED · OCR OFF</span></div></div>)}</section>
        <section style={{ padding: 16, borderRight: `1px solid ${colors.border}`, ...reveal(30) }}><div style={{ color: colors.orange, fontSize: 12, letterSpacing: 1.6 }}>FOCUSED SOURCE</div><h2 style={{ margin: "7px 0 14px", fontSize: 26 }}>PREVIEW</h2><div style={{ height: 295, display: "grid", placeItems: "center", border: `1px solid ${colors.border}`, background: "radial-gradient(circle,#ff9f1c 0 8%,#342316 9% 30%,#0a0c11 31%)" }}><div style={{ width: 155, height: 155, rotate: "45deg", border: `2px solid ${colors.orange}`, background: "linear-gradient(135deg,#11151d 45%,#ff9f1c 46%)", boxShadow: "0 0 46px rgba(255,159,28,.25)" }} /></div><p style={{ margin: "13px 0 0", color: colors.muted, fontSize: 12 }}>pyramid.webp · exact local source bytes</p></section>
        <section style={{ padding: 16, ...reveal(42) }}><div style={{ color: colors.orange, fontSize: 12, letterSpacing: 1.6 }}>PROMPT INTENT</div><h2 style={{ margin: "7px 0 14px", fontSize: 26 }}>SETTINGS</h2>{["DEFAULTS", "OpenAI GPT Image", "Match source", "Preserve visible text"].map((label, index) => <div key={label} style={{ marginTop: 9, padding: "11px 12px", border: `1px solid ${index === 0 ? colors.orange : colors.border}`, color: index === 0 ? "#161009" : colors.text, background: index === 0 ? colors.orange : colors.canvas, fontSize: 12, fontWeight: index === 0 ? 700 : 400 }}>{label}</div>)}</section>
      </div>
    </div>
  </ReleaseV08Shell>;
}
