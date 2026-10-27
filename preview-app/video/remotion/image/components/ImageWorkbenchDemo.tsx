import type { ReactNode } from "react";
import { Easing, Img, interpolate, staticFile } from "remotion";
import { colors } from "../../components/theme";

export type ImageDemoStage = "intake" | "settings" | "review" | "package";

const sources = [
  { name: "orange-pyramid.webp", src: staticFile("image/orange-pyramid.webp"), size: "1536 × 1536" },
  { name: "workbench-poster.webp", src: staticFile("media/demo/overview-poster.webp"), size: "1280 × 720" },
  { name: "package-poster.webp", src: staticFile("media/demo/package-poster.webp"), size: "1280 × 720" },
] as const;

function Panel({ active, width, children }: { readonly active: boolean; readonly width: string; readonly children: ReactNode }) {
  return <section style={{
    width,
    minWidth: 0,
    overflow: "hidden",
    border: `1px solid ${active ? colors.orange : colors.border}`,
    backgroundColor: active ? "#1c1710" : colors.surface,
    boxShadow: active ? "0 0 0 2px rgba(255,159,28,.12), 0 20px 48px rgba(0,0,0,.34)" : "none",
  }}>{children}</section>;
}

function SectionTitle({ eyebrow, children }: { readonly eyebrow: string; readonly children: ReactNode }) {
  return <div style={{ padding: "11px 14px", borderBottom: `1px solid ${colors.border}` }}>
    <div style={{ color: colors.orange, fontSize: 9, letterSpacing: 1.6, marginBottom: 4 }}>{eyebrow}</div>
    <div style={{ fontSize: 16, fontWeight: 700 }}>{children}</div>
  </div>;
}

function Button({ children, accent = "neutral", disabled = false }: {
  readonly children: ReactNode;
  readonly accent?: "neutral" | "orange" | "yellow";
  readonly disabled?: boolean;
}) {
  const color = accent === "orange" ? colors.orange : accent === "yellow" ? "#ffd166" : colors.text;
  return <div style={{
    display: "grid",
    placeItems: "center",
    minHeight: 28,
    padding: "6px 10px",
    border: `1px solid ${disabled ? colors.border : color}`,
    color: disabled ? "#5e6676" : color,
    background: accent === "orange" && !disabled ? colors.orange : colors.canvas,
    fontSize: 10,
    fontWeight: 700,
    ...(accent === "orange" && !disabled ? { color: "#19130a" } : {}),
  }}>{children}</div>;
}

function QueueCard({ index, selected, focused }: { readonly index: number; readonly selected: boolean; readonly focused: boolean }) {
  const source = sources[index];
  return <div style={{ display: "grid", gridTemplateColumns: "58px 1fr", gap: 9, padding: 10, border: `1px solid ${focused ? colors.orange : colors.border}`, background: focused ? "#17140f" : colors.canvas }}>
    <Img src={source.src} style={{ width: 58, height: 48, objectFit: "cover", borderRadius: 4 }} />
    <div style={{ minWidth: 0 }}>
      <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }}>{source.name}</strong>
      <span style={{ display: "block", color: colors.muted, fontSize: 9, marginTop: 3 }}>{source.size} · OCR OFF</span>
      <span style={{ display: "block", color: colors.orange, fontSize: 9, marginTop: 4 }}>{selected ? "☑ SELECTED · INCLUDED" : "INCLUDED"}</span>
    </div>
  </div>;
}

function Field({ label, value, active = false }: { readonly label: string; readonly value: string; readonly active?: boolean }) {
  return <div style={{ display: "grid", gap: 4 }}>
    <span style={{ color: colors.muted, fontSize: 9 }}>{label}</span>
    <div style={{ padding: "7px 9px", border: `1px solid ${active ? colors.orange : colors.border}`, background: colors.canvas, fontSize: 10 }}>{value}</div>
  </div>;
}

export function ImageWorkbenchDemo({ stage, frame }: { readonly stage: ImageDemoStage; readonly frame: number }) {
  const selectedCount = stage === "settings" ? (frame < 55 ? 0 : frame < 105 ? 1 : 2) : stage === "review" || stage === "package" ? 2 : 0;
  const focusedIndex = stage === "intake" && frame > 95 ? 1 : 0;
  const useSelected = stage === "settings" && frame > 105;
  const ocrReviewed = stage === "review" && frame > 115;
  const confirmed = stage === "package" && frame > 45;
  const built = stage === "package" && frame > 105;
  const downloaded = stage === "package" && frame > 175;
  const pointerX = stage === "intake"
    ? interpolate(frame, [12, 80, 145], [120, 155, 340], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) })
    : stage === "settings"
      ? interpolate(frame, [10, 90, 170], [170, 220, 1028], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
      : stage === "review"
        ? interpolate(frame, [10, 80, 160], [640, 790, 730], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
        : interpolate(frame, [10, 80, 145, 205], [1050, 1060, 1040, 1030], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const pointerY = stage === "intake"
    ? interpolate(frame, [12, 80, 145], [92, 198, 280], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : stage === "settings"
      ? interpolate(frame, [10, 90, 170], [210, 300, 220], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
      : stage === "review"
        ? interpolate(frame, [10, 80, 160], [360, 388, 438], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
        : interpolate(frame, [10, 80, 145, 205], [110, 188, 240, 294], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return <div style={{ position: "relative", height: 536, border: `1px solid ${colors.border}`, background: colors.canvas }}>
    <div style={{ height: 48, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 15px", borderBottom: `1px solid ${colors.border}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <strong style={{ color: colors.orange, fontSize: 15 }}>reword_nerd/</strong>
        <span style={{ color: colors.mint, fontSize: 11 }}>TEXT</span>
        <span style={{ color: colors.orange, fontSize: 11, borderBottom: `2px solid ${colors.orange}`, paddingBottom: 5 }}>IMAGE</span>
      </div>
      <div style={{ fontSize: 10 }}><strong>LOCAL SESSION</strong> <span style={{ color: colors.muted }}>Files stay in this browser</span></div>
    </div>
    <div style={{ display: "flex", height: 486 }}>
      <Panel active={stage === "intake"} width="25%">
        <SectionTitle eyebrow="IMAGE SET">IMAGES</SectionTitle>
        <div style={{ padding: 11, display: "grid", gap: 9 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}><Button accent={stage === "intake" && frame < 70 ? "orange" : "neutral"}>ADD IMAGES</Button><Button>ADD FOLDER</Button></div>
          {sources.map((_, index) => <QueueCard key={sources[index].name} index={index} selected={index < selectedCount} focused={index === focusedIndex} />)}
        </div>
      </Panel>
      <Panel active={stage === "review"} width="48%">
        <SectionTitle eyebrow="FOCUSED SOURCE">PREVIEW</SectionTitle>
        <div style={{ padding: 12 }}>
          <div style={{ height: 238, display: "grid", placeItems: "center", overflow: "hidden", border: `1px solid ${colors.border}`, background: "#0c0d11" }}>
            <Img src={sources[focusedIndex].src} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 10 }}>
            <div><strong style={{ display: "block", fontSize: 12 }}>{sources[focusedIndex].name}</strong><span style={{ color: colors.muted, fontSize: 9 }}>{sources[focusedIndex].size} · exact local source bytes</span></div>
            <span style={{ color: "#ff6178", fontSize: 9 }}>WARNING · REVIEW METADATA</span>
          </div>
          <div style={{ marginTop: 10, padding: 11, border: `1px solid ${stage === "review" ? "#ffd166" : colors.border}`, background: colors.surface }}>
            <strong style={{ fontSize: 11 }}>VISIBLE TEXT / OCR</strong>
            <p style={{ margin: "7px 0", color: colors.muted, fontSize: 9, lineHeight: 1.35 }}>{ocrReviewed ? "Reviewed text accepted for this prompt." : "OCR is optional, local, and enters a prompt only after review."}</p>
            <Button accent={ocrReviewed ? "yellow" : "neutral"}>{ocrReviewed ? "OCR REVIEW ACCEPTED" : "RUN LOCAL OCR"}</Button>
          </div>
        </div>
      </Panel>
      <Panel active={stage === "settings" || stage === "package"} width="27%">
        <SectionTitle eyebrow="PROMPT INTENT">SETTINGS</SectionTitle>
        <div style={{ padding: 11, display: "grid", gap: 9 }}>
          {stage === "package" ? <>
            <div style={{ padding: 10, border: `1px solid ${confirmed ? "#ffd166" : colors.border}` }}>
              <strong style={{ display: "block", marginBottom: 7, fontSize: 12 }}>IMAGE SET REVIEW</strong>
              <Button accent="yellow" disabled={confirmed}>CONFIRM IMAGE SET</Button>
            </div>
            <Button accent="orange" disabled={!confirmed}>{built ? "PACKAGE READY" : "BUILD PACKAGE"}</Button>
            <Button accent={downloaded ? "orange" : "neutral"} disabled={!built}>{downloaded ? "DOWNLOADED · 2026-08-14-173000" : "DOWNLOAD TIMESTAMPED ZIP"}</Button>
            <div style={{ padding: 10, border: `1px solid ${colors.border}`, background: colors.surface, fontSize: 9, lineHeight: 1.5 }}>
              <strong style={{ display: "block", marginBottom: 5 }}>PACKAGE PREVIEW</strong>
              <span style={{ color: colors.muted }}>{built ? "3 prompt/image pairs · OPEN-ME-FULL.html · SHA-256 verified" : "Build creates the confirmed ZIP in memory."}</span>
            </div>
          </> : <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}><Button accent={!useSelected ? "orange" : "neutral"}>DEFAULTS</Button><Button accent={useSelected ? "orange" : "neutral"}>SELECTED [{selectedCount}]</Button></div>
            <Field label="Model family" value="OpenAI GPT Image" active={stage === "settings" && frame > 125} />
            <Field label="Aspect ratio" value="Match source" />
            <Field label="Size intent" value="Highest practical quality" />
            <Field label="Visible text" value="Preserve" />
            <Field label="Requested changes" value={useSelected ? "Warm the palette; preserve layout." : "Faithful rendition"} active={useSelected} />
            {useSelected && <Button accent="orange">APPLY TO {selectedCount} IMAGES</Button>}
          </>}
        </div>
      </Panel>
    </div>
    <div style={{ position: "absolute", left: pointerX, top: pointerY, width: 19, height: 19, border: `3px solid ${colors.orange}`, borderRadius: "50%", boxShadow: `0 0 18px ${colors.orange}`, opacity: interpolate(frame, [0, 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }} />
  </div>;
}
