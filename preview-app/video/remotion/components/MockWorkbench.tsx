import type { ReactNode } from "react";
import { Easing, interpolate } from "remotion";
import { colors } from "./theme";

type Focus = "settings" | "review" | "package";

function Panel({ active, width, children }: { active: boolean; width: string; children: ReactNode }) {
  return <div style={{
    width,
    minWidth: 0,
    overflow: "hidden",
    border: `1px solid ${active ? colors.mint : colors.border}`,
    backgroundColor: active ? "#111a1b" : colors.surface,
    boxShadow: active ? "0 0 0 2px rgba(66,232,180,.12), 0 20px 48px rgba(0,0,0,.34)" : "none",
  }}>{children}</div>;
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <div style={{ padding: "13px 16px", borderBottom: `1px solid ${colors.border}`, fontSize: 17, fontWeight: 700 }}>{children}</div>;
}

function Input({ label, value, selected = false }: { label: string; value: string; selected?: boolean }) {
  return <div style={{ display: "grid", gap: 5 }}>
    <span style={{ color: colors.muted, fontSize: 12 }}>{label}</span>
    <div style={{ padding: "9px 11px", border: `1px solid ${selected ? colors.mint : colors.border}`, background: colors.canvas, fontSize: 13 }}>{value}</div>
  </div>;
}

function MiniButton({ children, active = false }: { children: ReactNode; active?: boolean }) {
  return <div style={{ padding: "9px 13px", border: `1px solid ${active ? colors.mint : colors.border}`, color: active ? colors.mint : colors.muted, fontSize: 12, fontWeight: 700 }}>{children}</div>;
}

export function MockWorkbench({ focus, frame }: { focus: Focus; frame: number }) {
  const pointerX = interpolate(frame, [10, 70, 150, 230], [910, 1010, 746, 832], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const pointerY = focus === "settings"
    ? interpolate(frame, [10, 70, 150, 230], [158, 238, 334, 430], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : focus === "review"
      ? interpolate(frame, [10, 90, 180, 240], [176, 350, 490, 550], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
      : interpolate(frame, [10, 90, 180, 240], [156, 250, 420, 530], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const reviewed = focus === "review" && frame > 185;
  const built = focus === "package" && frame > 80;

  return <div style={{ position: "relative", display: "flex", height: 520, border: `1px solid ${colors.border}`, background: colors.canvas }}>
    <Panel active={false} width="22%">
      <SectionTitle>FILES [1]</SectionTitle>
      <div style={{ padding: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "30px 1fr", gap: 10, padding: 12, border: `1px solid ${colors.border}`, background: colors.raised }}>
          <div style={{ color: colors.mint, fontSize: 23 }}>▱</div>
          <div style={{ minWidth: 0 }}><strong style={{ display: "block", fontSize: 13 }}>research-note.pdf</strong><span style={{ color: reviewed ? colors.mint : colors.amber, fontSize: 10 }}>{reviewed ? "READY" : "REVIEW"}</span></div>
        </div>
      </div>
    </Panel>
    <Panel active={focus === "review" || focus === "package"} width={focus === "settings" ? "48%" : "58%"}>
      <SectionTitle>{built ? "PACKAGE PREVIEW" : "EXTRACTED_TEXT"}</SectionTitle>
      {built ? <div style={{ padding: 18 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}><MiniButton active>RUNBOOK</MiniButton><MiniButton>ONE-SHOT</MiniButton><MiniButton>MANUAL</MiniButton></div>
        <div style={{ padding: 18, border: `1px solid ${colors.border}`, background: colors.raised }}>
          <strong style={{ display: "block", marginBottom: 16, color: colors.mint, fontSize: 19 }}>Package runbook</strong>
          <div style={{ display: "grid", gap: 12, color: colors.muted, fontSize: 13, lineHeight: 1.45 }}>
            <span>1. Open the reviewed extraction and packaged assets.</span>
            <span>2. Choose One-shot or the four-stage Manual workflow.</span>
            <span>3. Copy prompts and preserve the response markers.</span>
            <span>4. Download the ZIP or a local progress copy.</span>
          </div>
        </div>
      </div> : <div style={{ padding: 18 }}>
        <div style={{ padding: 18, height: 266, overflow: "hidden", border: `1px solid ${colors.border}`, background: colors.raised, fontSize: 13, lineHeight: 1.65 }}>
          <strong style={{ display: "block", marginBottom: 13, fontSize: 18 }}>A compact study of local-first writing workflows</strong>
          <span style={{ color: colors.muted }}>Abstract</span>
          <p>Clear revision workflows preserve claims, evidence, and figures while changing phrasing and organization. This synthetic document demonstrates a review-first package.</p>
          <p>Every extraction remains editable before any prompt is generated.</p>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <div style={{ width: 150, height: 94, padding: 10, border: `1px solid ${colors.border}`, background: colors.canvas }}><span style={{ color: colors.mint, fontSize: 11 }}>FIGURE 1</span><div style={{ display: "flex", height: 54, alignItems: "end", gap: 5 }}>{[22, 35, 28, 48, 42, 57].map((height, index) => <i key={height} style={{ width: 13, height: height - (frame > index * 14 ? 0 : 18), background: index > 3 ? colors.mint : colors.muted }} />)}</div></div>
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "end" }}><MiniButton active={reviewed}>{reviewed ? "REVIEW CONFIRMED" : "CONFIRM REVIEW"}</MiniButton></div>
        </div>
      </div>}
    </Panel>
    <Panel active={focus === "settings"} width={focus === "settings" ? "30%" : "20%"}>
      <SectionTitle>PARAMETERS</SectionTitle>
      <div style={{ display: "grid", gap: 10, padding: 14 }}>
        <Input label="Model profile" value="OpenAI / ChatGPT" selected={focus === "settings" && frame > 30 && frame < 100} />
        <Input label="Context limit" value="1,050,000" selected={focus === "settings" && frame >= 100 && frame < 160} />
        <Input label="Tone" value={focus === "settings" && frame > 155 ? "Academic" : "Preserve source"} selected={focus === "settings" && frame >= 160} />
        <Input label="Output language" value="Preserve source language" />
        <div style={{ paddingTop: 5, color: colors.mint, fontSize: 11 }}>DOCUMENT PROCESSING</div>
        <div style={{ color: colors.muted, fontSize: 11 }}>☑ Extract embedded images</div>
      </div>
    </Panel>
    <div style={{ position: "absolute", left: pointerX, top: pointerY, width: 22, height: 22, border: `3px solid ${colors.mint}`, borderRadius: "50%", boxShadow: `0 0 18px ${colors.mint}`, opacity: interpolate(frame, [0, 15], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }} />
  </div>;
}
