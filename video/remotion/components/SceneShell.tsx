import type { ReactNode } from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, mono } from "./theme";

export function SceneShell({ children, eyebrow, title }: {
  children: ReactNode;
  eyebrow: string;
  title: string;
}) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return <AbsoluteFill style={{
    padding: "54px 64px 48px",
    color: colors.text,
    backgroundColor: colors.canvas,
    fontFamily: mono,
    opacity: interpolate(frame, [0, 14, durationInFrames - 15, durationInFrames - 1], [0, 1, 1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    }),
  }}>
    <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", gap: 24, marginBottom: 24 }}>
      <div>
        <div style={{ color: colors.mint, fontSize: 18, letterSpacing: 2.4, marginBottom: 9 }}>{eyebrow}</div>
        <div style={{ fontSize: 42, fontWeight: 700, lineHeight: 1.08 }}>{title}</div>
      </div>
      <div style={{ padding: "8px 12px", border: `1px solid ${colors.border}`, color: colors.muted, fontSize: 15 }}>SYNTHETIC DEMO</div>
    </div>
    {children}
  </AbsoluteFill>;
}
