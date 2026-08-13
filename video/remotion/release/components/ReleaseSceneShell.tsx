import type { ReactNode } from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, mono } from "../../components/theme";

export function ReleaseSceneShell({ children, label, scene }: { children: ReactNode; label: string; scene: string }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return <AbsoluteFill style={{
    padding: "66px 92px 60px",
    color: colors.text,
    backgroundColor: colors.canvas,
    fontFamily: mono,
    opacity: interpolate(frame, [0, 12, durationInFrames - 14, durationInFrames - 1], [0, 1, 1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    }),
  }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 28, color: colors.muted, fontSize: 17, letterSpacing: 1.8 }}>
      <span style={{ color: colors.mint }}>{label}</span>
      <span>{scene} / 05</span>
      <span style={{ padding: "7px 10px", border: `1px solid ${colors.border}`, fontSize: 13 }}>SYNTHETIC</span>
    </div>
    {children}
  </AbsoluteFill>;
}
