import type { ReactNode } from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { colors, mono } from "../../components/theme";

export function ReleaseV08Shell({ children, durationInFrames, eyebrow, scene }: {
  readonly children: ReactNode;
  readonly durationInFrames: number;
  readonly eyebrow: string;
  readonly scene: string;
}) {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{
    padding: "54px 72px 52px",
    overflow: "hidden",
    color: colors.text,
    backgroundColor: colors.canvas,
    backgroundImage: "radial-gradient(circle at 82% 18%, rgba(255,159,28,.12), transparent 34%), linear-gradient(rgba(255,255,255,.015) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.015) 1px, transparent 1px)",
    backgroundSize: "auto, 36px 36px, 36px 36px",
    fontFamily: mono,
    opacity: interpolate(frame, [0, 12, durationInFrames - 13, durationInFrames - 1], [0, 1, 1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    }),
  }}>
    <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, paddingBottom: 18, borderBottom: `1px solid ${colors.border}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <strong style={{ color: colors.orange, fontSize: 19 }}>reword_nerd/</strong>
        <span style={{ color: colors.muted, fontSize: 14 }}>v0.8 UPDATE</span>
      </div>
      <div style={{ color: colors.orange, fontSize: 15, letterSpacing: 2 }}>{eyebrow}</div>
      <div style={{ padding: "7px 10px", border: `1px solid ${colors.border}`, color: colors.muted, fontSize: 12 }}>SILENT · SYNTHETIC · {scene}/05</div>
    </header>
    {children}
  </AbsoluteFill>;
}
