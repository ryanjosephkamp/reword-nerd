import { Easing, interpolate, useCurrentFrame } from "remotion";
import { colors } from "../../components/theme";
import { ReleaseV08Shell } from "../components/ReleaseV08Shell";

export function TextPolishSceneV08() {
  const frame = useCurrentFrame();
  const cards = [
    ["CONTINUOUS + GALLERY", "Scroll every PDF page or scan the full page grid."],
    ["SELECTABLE TEXT", "Keep extracted text contained beneath its source page."],
    ["NIGHT TERMINAL HTML", "Open TEXT and IMAGE exports in the same polished system."],
    ["TIMESTAMPED DOWNLOADS", "Give every package ZIP a clear creation time."],
  ] as const;
  return <ReleaseV08Shell durationInFrames={150} eyebrow="CHANGED + FIXED" scene="04">
    <div style={{ display: "grid", gridTemplateColumns: "1.08fr .92fr", gap: 36, alignItems: "center", height: "calc(100% - 58px)" }}>
      <div style={{ height: 460, padding: 17, border: `1px solid ${colors.border}`, background: colors.surface, opacity: interpolate(frame, [6, 28], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>{["CONTINUOUS", "GALLERY", "FIT WIDTH"].map((label, index) => <div key={label} style={{ padding: "8px 10px", border: `1px solid ${index < 2 ? colors.mint : colors.border}`, color: index < 2 ? colors.mint : colors.muted, fontSize: 11 }}>{label}</div>)}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {[1, 2, 3, 4].map((page) => <div key={page} style={{ height: 166, padding: 12, background: "#e9e9e6", color: "#333", opacity: interpolate(frame, [18 + page * 9, 32 + page * 9], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) }) }}><strong style={{ display: "block", fontFamily: "Georgia, serif", textAlign: "center", fontSize: 14 }}>Synthetic document · {page}</strong><div style={{ display: "grid", gap: 7, marginTop: 17 }}>{[90, 76, 85, 68, 82].map((width, index) => <i key={index} style={{ display: "block", width: `${width}%`, height: 4, background: "#777" }} />)}</div><div style={{ marginTop: 18, height: 38, border: "1px solid #aaa", background: page % 2 === 0 ? "#ddd" : "#c9d5da" }} /></div>)}
        </div>
      </div>
      <div>
        <h2 style={{ margin: 0, fontSize: 48, lineHeight: 1.08, letterSpacing: -2 }}>Polished both portals.</h2>
        <div style={{ display: "grid", gap: 12, marginTop: 27 }}>{cards.map(([label, detail], index) => <div key={label} style={{ padding: "15px 17px", border: `1px solid ${index < 2 ? colors.mint : colors.orange}`, background: colors.surface, opacity: interpolate(frame, [20 + index * 13, 38 + index * 13], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), translate: `0 ${interpolate(frame, [20 + index * 13, 38 + index * 13], [15, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px` }}><strong style={{ display: "block", color: index < 2 ? colors.mint : colors.orange, fontSize: 15 }}>{label}</strong><span style={{ display: "block", marginTop: 7, color: colors.muted, fontSize: 14, lineHeight: 1.35 }}>{detail}</span></div>)}</div>
      </div>
    </div>
  </ReleaseV08Shell>;
}
