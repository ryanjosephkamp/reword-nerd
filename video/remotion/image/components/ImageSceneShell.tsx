import type { ReactNode } from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, mono } from "../../components/theme";

export function ImageSceneShell({ children, eyebrow, title }: {
  readonly children: ReactNode;
  readonly eyebrow: string;
  readonly title: string;
}) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return <AbsoluteFill style={{
    padding: "42px 50px 38px",
    color: colors.text,
    backgroundColor: colors.canvas,
    fontFamily: mono,
    opacity: interpolate(frame, [0, 12, durationInFrames - 13, durationInFrames - 1], [0, 1, 1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    }),
  }}>
    <header style={{ display: "flex", alignItems: "end", justifyContent: "space-between", gap: 24, marginBottom: 20 }}>
      <div>
        <div style={{ color: colors.orange, fontSize: 17, letterSpacing: 2.4, marginBottom: 8 }}>{eyebrow}</div>
        <div style={{ fontSize: 38, fontWeight: 700, lineHeight: 1.08 }}>{title}</div>
      </div>
      <div style={{ padding: "8px 12px", border: `1px solid ${colors.border}`, color: colors.muted, fontSize: 14 }}>SILENT · SYNTHETIC · LOCAL</div>
    </header>
    {children}
  </AbsoluteFill>;
}
