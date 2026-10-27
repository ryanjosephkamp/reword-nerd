export interface ReviewStage {
  stage: string | number;
  prompt: string;
  response: string;
}

export interface ReviewInput {
  documentName: string;
  sourceText: string;
  finalText: string;
  stages: ReviewStage[];
  receipt: Record<string, unknown>;
}

const STAGE_NAMES = ['Decompose', 'Rewrite', 'Verify', 'Final'];

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function wordCount(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

function number(value: number): string {
  return value.toLocaleString('en-US');
}

function stageName(stage: string | number): string {
  const raw = String(stage);
  const numeric = raw.match(/^0?([1-4])(?:\D|$)/)?.[1];
  if (numeric) return STAGE_NAMES[Number(numeric) - 1];
  return (
    STAGE_NAMES.find((name) => raw.toLowerCase() === name.toLowerCase()) ?? raw
  );
}

function receiptText(
  receipt: Record<string, unknown>,
  key: string,
): string | null {
  const value = receipt[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function executionInfo(receipt: Record<string, unknown>): {
  label: string;
  description: string;
  kind: string;
} {
  switch (receipt.executionMode) {
    case 'fixture':
      return {
        label: 'Fixture replay',
        description:
          'These responses came from a fixture. They demonstrate the workflow and are not evidence of a live model run.',
        kind: 'fixture',
      };
    case 'host':
      return {
        label: 'Reported host run',
        description:
          'The receipt labels this as host-assisted. The companion does not independently verify the host or model. It makes no provider calls; the chosen host controls execution and data handling.',
        kind: 'host',
      };
    case 'manual':
      return {
        label: 'Reported manual responses',
        description:
          'The receipt labels these responses as manually supplied. Their model or author provenance is limited to the reported metadata.',
        kind: 'manual',
      };
    default:
      return {
        label: 'Execution not specified',
        description:
          'The receipt does not identify this as a host run, manual response set, or fixture replay. Do not infer model provenance from a completed document.',
        kind: 'unknown',
      };
  }
}

function renderStage(stage: ReviewStage, index: number): string {
  const hasResponse = Boolean(stage.response.trim());
  return `<details class="stage">
    <summary>
      <span class="stage-number">${number(index + 1).padStart(2, '0')}</span>
      <span class="stage-title">${escapeHtml(stageName(stage.stage))}<small>${hasResponse ? `${number(wordCount(stage.response))} response words` : 'Awaiting a response'}</small></span>
      <span class="stage-state${hasResponse ? ' is-recorded' : ''}">${hasResponse ? 'Recorded' : 'Pending'}</span>
      <span class="disclosure" aria-hidden="true">+</span>
    </summary>
    <div class="stage-content">
      <div class="audit-heading"><h3>Task prompt</h3><span>Audit material</span></div>
      <pre class="raw-text"><code>${escapeHtml(stage.prompt || 'No prompt was included in this report.')}</code></pre>
      <div class="audit-heading response-heading"><h3>Raw response</h3><span>${hasResponse ? 'As recorded' : 'Not yet recorded'}</span></div>
      <pre class="raw-text"><code>${escapeHtml(stage.response || 'No response was included in this report.')}</code></pre>
    </div>
  </details>`;
}

/** Render a portable review artifact. User content is plain text, never executable markup. */
export function renderReview(input: ReviewInput): string {
  const { documentName, sourceText, finalText, stages, receipt } = input;
  const sourceWords = wordCount(sourceText);
  const finalWords = wordCount(finalText);
  const completedStages = stages.filter((stage) =>
    stage.response.trim(),
  ).length;
  const hasFinal = Boolean(finalText.trim());
  const execution = executionInfo(receipt);
  const executionMetadata =
    typeof receipt.execution === 'object' && receipt.execution !== null
      ? (receipt.execution as Record<string, unknown>)
      : {};
  const host =
    receiptText(receipt, 'host') ??
    receiptText(receipt, 'hostName') ??
    receiptText(executionMetadata, 'host');
  const model =
    receiptText(executionMetadata, 'model') ?? receiptText(receipt, 'model');
  const jobId = receiptText(receipt, 'jobId');
  const exportedAt =
    receiptText(receipt, 'exportedAt') ?? receiptText(receipt, 'createdAt');
  const delta = finalWords - sourceWords;
  const deltaLabel = !hasFinal
    ? 'Waiting for the final document'
    : delta === 0
      ? 'Same word count as the source'
      : `${number(Math.abs(delta))} ${delta < 0 ? 'fewer' : 'more'} words than the source`;
  let serializedReceipt: string;
  try {
    serializedReceipt = JSON.stringify(receipt, null, 2);
  } catch {
    serializedReceipt =
      'The supplied receipt could not be serialized. Consult the job receipt on disk.';
  }

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; script-src 'none'; base-uri 'none'; form-action 'none'">
  <title>${escapeHtml(documentName)} — reword_nerd review</title>
  <style>
    :root {
      --paper: #f3f1e7;
      --sheet: #fffef8;
      --ink: #1c2620;
      --muted: #58645a;
      --line: #d0d5c5;
      --mint: #c1ed9b;
      --deep: #17221b;
      --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --serif: Georgia, "Times New Roman", serif;
    }
    * {
      box-sizing: border-box;
    }
    html {
      scroll-behavior: smooth;
      scroll-padding-top: 24px;
    }
    body {
      margin: 0;
      background: var(--paper);
      color: var(--ink);
      font-family: var(--sans);
      font-size: 16px;
      line-height: 1.6;
    }
    a {
      color: inherit;
      text-underline-offset: 0.22em;
    }
    a:focus-visible,
    summary:focus-visible {
      outline: 3px solid #477d26;
      outline-offset: 6px;
      border-radius: 2px;
    }
    .skip {
      position: absolute;
      left: 16px;
      top: -100px;
      z-index: 2;
      padding: 10px 16px;
      background: var(--deep);
      color: #fff;
    }
    .skip:focus {
      top: 12px;
    }
    .shell {
      width: min(1320px, 100% - 96px);
      margin-inline: auto;
    }
    .masthead {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      min-height: 110px;
      border-bottom: 1px solid var(--line);
    }
    .brand {
      display: flex;
      gap: 12px;
      align-items: center;
      font-weight: 740;
      font-size: 19px;
      letter-spacing: -0.7px;
    }
    .mark {
      width: 37px;
      height: 37px;
      display: grid;
      place-items: center;
      border-radius: 10px;
      background: var(--ink);
      color: var(--mint);
      font-family: var(--serif);
      font-size: 23px;
      font-style: italic;
      letter-spacing: -3px;
      padding-right: 4px;
    }
    .brand-dot {
      color: #608649;
    }
    .eyebrow,
    .tiny-label {
      font-family: var(--mono);
      font-size: 10px;
      letter-spacing: 1.7px;
      text-transform: uppercase;
      font-weight: 500;
    }
    .masthead .eyebrow {
      color: var(--muted);
    }
    .nav {
      display: flex;
      gap: 25px;
      font-size: 12px;
      color: var(--muted);
    }
    .nav a {
      text-decoration: none;
    }
    .nav a:hover {
      text-decoration: underline;
    }
    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 260px;
      gap: 60px;
      padding: 68px 0 50px;
      align-items: end;
    }
    .status {
      display: inline-flex;
      gap: 8px;
      align-items: center;
      font-family: var(--mono);
      font-size: 10px;
      letter-spacing: 1.2px;
      text-transform: uppercase;
      color: #40612f;
    }
    .status:before {
      content: "";
      width: 6px;
      height: 6px;
      background: #608b45;
      border-radius: 50%;
    }
    h1 {
      font-family: var(--serif);
      font-weight: 400;
      font-size: clamp(43px, 5.2vw, 72px);
      line-height: 1.06;
      letter-spacing: -2.7px;
      margin: 19px 0 19px;
    }
    h1 em {
      font-weight: 400;
      color: #526e3d;
    }
    .lede {
      font-size: 15px;
      max-width: 620px;
      color: var(--muted);
      margin: 0;
      line-height: 1.75;
    }
    .filename {
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .hero-note {
      border-left: 1px solid var(--line);
      padding-left: 24px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.75;
    }
    .hero-note .tiny-label {
      display: block;
      color: var(--ink);
      margin-bottom: 12px;
    }
    .metrics {
      display: grid;
      grid-template-columns: 1fr 1fr 1.15fr;
      border-top: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
      margin-bottom: 40px;
    }
    .metric {
      padding: 23px 26px 25px 0;
    }
    .metric + .metric {
      border-left: 1px solid var(--line);
      padding-left: 28px;
    }
    .metric .tiny-label {
      display: block;
      color: var(--muted);
      font-size: 9px;
      letter-spacing: 1.5px;
    }
    .metric strong {
      display: block;
      font-family: var(--serif);
      font-size: 36px;
      font-weight: 400;
      line-height: 1.1;
      margin: 12px 0 7px;
      letter-spacing: -1px;
    }
    .metric small {
      font-size: 11px;
      color: var(--muted);
      line-height: 1.45;
      display: block;
    }
    .metric .progress {
      display: flex;
      gap: 5px;
      margin: 16px 0 11px;
      max-width: 180px;
    }
    .progress span {
      height: 5px;
      flex: 1;
      background: #d9decd;
    }
    .progress span.complete {
      background: #71975a;
    }
    .metric .progress-count {
      font-family: var(--sans);
      font-size: 15px;
      font-weight: 600;
      letter-spacing: 0;
      margin: 8px 0;
    }
    .content-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 280px;
      gap: 36px;
      align-items: start;
    }
    .reader {
      background: var(--sheet);
      border: 1px solid var(--line);
      box-shadow: 0 3px 0 #e7e9dc;
    }
    .reader-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      border-bottom: 1px solid var(--line);
      padding: 22px 34px;
    }
    .reader-top h2 {
      margin: 0;
      font-family: var(--mono);
      font-size: 10px;
      letter-spacing: 1.6px;
      font-weight: 500;
      text-transform: uppercase;
    }
    .reader-top span {
      color: var(--muted);
      font-size: 10px;
    }
    .document {
      font-family: var(--serif);
      font-size: 19px;
      line-height: 1.9;
      padding: 42px 48px 54px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      tab-size: 2;
      min-height: 220px;
    }
    .document.pending {
      font-size: 23px;
      color: var(--muted);
      font-style: italic;
      line-height: 1.7;
    }
    .reader-foot {
      margin: 0;
      padding: 16px 34px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 11px;
      background: #f7f8ee;
    }
    .side-card {
      padding: 25px 24px;
      background: #e9eddf;
      border: 1px solid #d3dcc6;
      margin-bottom: 16px;
    }
    .side-card h2 {
      font-family: var(--serif);
      font-size: 25px;
      font-weight: 400;
      line-height: 1.2;
      letter-spacing: -0.5px;
      margin: 12px 0;
    }
    .side-card p {
      font-size: 12px;
      color: #4f5f48;
      line-height: 1.75;
      margin: 12px 0 0;
    }
    .mode-badge {
      display: inline-block;
      font-size: 9px;
      font-family: var(--mono);
      text-transform: uppercase;
      letter-spacing: 1px;
      padding: 5px 8px;
      border: 1px solid #b7c5a7;
      background: #f4f7ec;
      border-radius: 3px;
    }
    .mode-fixture {
      background: #f7ecd4;
      border-color: #d0b780;
      color: #694e1b;
    }
    .mode-unknown {
      background: #f2ebdf;
      border-color: #cdbfa4;
      color: #685a41;
    }
    .facts {
      margin: 0;
    }
    .facts > div {
      padding: 12px 0;
      border-bottom: 1px solid #d0d8c6;
    }
    .facts > div:last-child {
      border-bottom: 0;
      padding-bottom: 0;
    }
    .facts dt {
      color: #5a6953;
      font-size: 10px;
      letter-spacing: 0.2px;
      margin-bottom: 4px;
    }
    .facts dd {
      margin: 0;
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .local-note {
      padding: 11px 5px;
      font-size: 11px;
      line-height: 1.8;
      color: var(--muted);
    }
    .local-note strong {
      font-weight: 600;
      color: var(--ink);
    }
    .section {
      margin-top: 52px;
    }
    .section-head {
      display: flex;
      justify-content: space-between;
      gap: 25px;
      align-items: end;
      margin-bottom: 21px;
    }
    .section-head h2 {
      font-family: var(--serif);
      font-size: 33px;
      line-height: 1.2;
      letter-spacing: -0.9px;
      font-weight: 400;
      margin: 0;
    }
    .section-head p {
      margin: 6px 0 0;
      font-size: 12px;
      color: var(--muted);
      max-width: 620px;
    }
    .section-head > .tiny-label {
      color: var(--muted);
      white-space: nowrap;
      margin-bottom: 5px;
    }
    .source-details,
    .receipt-details {
      border: 1px solid var(--line);
      background: #eef0e4;
    }
    .source-details > summary,
    .receipt-details > summary {
      padding: 19px 23px;
      font-size: 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      cursor: pointer;
      list-style: none;
    }
    .source-details summary::-webkit-details-marker,
    .receipt-details summary::-webkit-details-marker,
    .stage summary::-webkit-details-marker {
      display: none;
    }
    .disclosure {
      font-family: var(--mono);
      font-size: 20px;
      font-weight: 400;
      line-height: 1;
      color: #5c7550;
      flex-shrink: 0;
    }
    details[open] > summary > .disclosure {
      transform: rotate(45deg);
    }
    .source-text {
      margin: 0;
      padding: 8px 25px 28px;
      font-family: var(--serif);
      font-size: 16px;
      line-height: 1.85;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .stage {
      border-top: 1px solid var(--line);
    }
    .stage:last-child {
      border-bottom: 1px solid var(--line);
    }
    .stage > summary {
      display: flex;
      align-items: center;
      gap: 20px;
      padding: 22px 2px;
      list-style: none;
      cursor: pointer;
    }
    .stage > summary:hover .stage-title {
      text-decoration: underline;
      text-underline-offset: 4px;
    }
    .stage-number {
      font-family: var(--mono);
      font-size: 11px;
      color: #718164;
      align-self: flex-start;
      padding-top: 6px;
    }
    .stage-title {
      font-family: var(--serif);
      font-size: 24px;
      line-height: 1.3;
      flex: 1;
    }
    .stage-title small {
      display: block;
      font-family: var(--sans);
      font-size: 10px;
      line-height: 1.5;
      color: var(--muted);
      margin-top: 5px;
    }
    .stage-state {
      font-size: 9px;
      font-family: var(--mono);
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--muted);
    }
    .stage-state.is-recorded {
      color: #496637;
    }
    .stage .disclosure {
      margin-left: 12px;
    }
    .stage-content {
      padding: 0 0 27px 37px;
    }
    .audit-heading {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 18px;
      padding: 14px 17px;
      background: #e5eadb;
      border: 1px solid var(--line);
      border-bottom: 0;
    }
    .audit-heading h3 {
      font-family: var(--mono);
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 1px;
      text-transform: uppercase;
      margin: 0;
    }
    .audit-heading span {
      font-size: 10px;
      color: var(--muted);
    }
    .response-heading {
      margin-top: 20px;
    }
    .raw-text code {
      font: inherit;
    }
    .raw-text {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      margin: 0;
      padding: 19px 18px;
      background: #f8f8f0;
      border: 1px solid var(--line);
      font-family: var(--mono);
      font-size: 11px;
      line-height: 1.8;
      tab-size: 2;
    }
    .receipt-details .raw-text {
      border: 0;
      border-top: 1px solid var(--line);
      max-height: 560px;
      overflow: auto;
    }
    .receipt-foot {
      font-size: 11px;
      color: var(--muted);
      line-height: 1.75;
      margin-top: 12px;
    }
    .footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 25px;
      margin-top: 64px;
      padding: 26px 0 35px;
      border-top: 1px solid var(--line);
      font-size: 10px;
      color: var(--muted);
    }
    .footer span:last-child {
      font-family: var(--mono);
      font-size: 9px;
      letter-spacing: 1px;
      text-transform: uppercase;
    }
    @media (min-width: 1100px) {
      .sidebar {
        position: sticky;
        top: 24px;
      }
    }
    @media (max-width: 1000px) {
      .shell {
        width: calc(100% - 56px);
      }
      .hero {
        gap: 30px;
        grid-template-columns: minmax(0, 1fr) 220px;
      }
      .content-grid {
        grid-template-columns: minmax(0, 1fr) 235px;
        gap: 24px;
      }
      .document {
        padding: 34px;
        font-size: 18px;
      }
      .reader-top {
        padding-inline: 25px;
      }
      .side-card {
        padding: 21px 19px;
      }
    }
    @media (max-width: 760px) {
      .shell {
        width: calc(100% - 36px);
      }
      .masthead {
        min-height: 87px;
        gap: 16px;
      }
      .masthead > .eyebrow {
        display: none;
      }
      .brand {
        font-size: 17px;
        gap: 9px;
      }
      .mark {
        width: 32px;
        height: 32px;
        font-size: 21px;
      }
      .nav {
        font-size: 10px;
        gap: 16px;
      }
      .hero {
        display: block;
        padding: 45px 0 33px;
      }
      h1 {
        font-size: 49px;
        letter-spacing: -2px;
        max-width: 560px;
      }
      .lede {
        font-size: 14px;
      }
      .hero-note {
        border-left: 0;
        border-top: 1px solid var(--line);
        padding: 18px 0 0;
        margin-top: 25px;
        max-width: 560px;
      }
      .hero-note .tiny-label {
        margin-bottom: 7px;
      }
      .metrics {
        margin-bottom: 28px;
        grid-template-columns: 1fr 1fr;
      }
      .metric {
        padding: 20px 14px 21px 0;
      }
      .metric + .metric {
        padding-left: 20px;
      }
      .metric:last-child {
        grid-column: 1/-1;
        border-left: 0;
        border-top: 1px solid var(--line);
        padding: 16px 0 18px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        align-items: center;
        gap: 0 18px;
      }
      .metric:last-child .tiny-label {
        grid-column: 1/-1;
      }
      .metric .progress {
        grid-column: 2;
        grid-row: 2;
        margin: 11px 0 5px;
        max-width: none;
      }
      .metric .progress-count {
        grid-column: 1;
        grid-row: 2;
        font-size: 13px;
        margin-top: 11px;
      }
      .metric:last-child small {
        grid-column: 1/-1;
      }
      .metric strong {
        font-size: 34px;
      }
      .content-grid {
        display: flex;
        flex-direction: column;
        gap: 26px;
      }
      .main-column,
      .sidebar {
        width: 100%;
      }
      .sidebar {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
        order: -1;
      }
      .side-card {
        margin: 0;
        padding: 20px;
      }
      .side-card h2 {
        font-size: 22px;
      }
      .local-note {
        padding: 0 2px;
        margin: 0;
        align-self: center;
      }
      .facts {
        margin-top: 12px;
      }
      .side-card p {
        font-size: 11px;
      }
      .document {
        font-size: 18px;
        line-height: 1.85;
        padding: 28px 25px 35px;
        min-height: 200px;
      }
      .reader-top {
        padding: 18px 23px;
      }
      .reader-top span {
        font-size: 9px;
      }
      .reader-foot {
        padding: 14px 23px;
      }
      .section {
        margin-top: 38px;
      }
      .section-head {
        display: block;
      }
      .section-head h2 {
        font-size: 29px;
      }
      .section-head > .tiny-label {
        display: block;
        margin-top: 15px;
      }
      .stage > summary {
        gap: 13px;
        padding: 21px 2px;
      }
      .stage-title {
        font-size: 23px;
      }
      .stage .disclosure {
        margin-left: 3px;
      }
      .stage-content {
        padding-left: 0;
      }
      .footer {
        margin-top: 45px;
        align-items: start;
        line-height: 1.8;
      }
      .footer span:last-child {
        text-align: right;
      }
      .raw-text {
        font-size: 10px;
      }
      .source-text {
        padding-inline: 20px;
      }
      .source-details > summary,
      .receipt-details > summary {
        padding: 18px 19px;
      }
    }
    @media (max-width: 410px) {
      .shell {
        width: calc(100% - 28px);
      }
      h1 {
        font-size: 45px;
      }
      .sidebar {
        grid-template-columns: 1fr;
        gap: 13px;
      }
      .local-note {
        padding: 0 4px;
      }
      .side-card p {
        font-size: 12px;
      }
      .side-card h2 {
        margin-bottom: 9px;
      }
      .nav {
        gap: 12px;
      }
      .stage-state {
        font-size: 8px;
        letter-spacing: 0.5px;
      }
      .stage-title {
        font-size: 22px;
      }
      .stage-number {
        font-size: 10px;
      }
      .reader-top {
        align-items: start;
      }
      .reader-top span {
        max-width: 80px;
        text-align: right;
      }
      .document {
        padding-inline: 21px;
      }
    }
    @media (max-width: 359px) {
      .masthead {
        flex-wrap: wrap;
        gap: 12px;
        padding-block: 18px;
      }
      .nav {
        width: 100%;
        justify-content: space-between;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      html {
        scroll-behavior: auto;
      }
    }
    @media print {
      body {
        background: white;
      }
      .shell {
        width: 100%;
        max-width: none;
      }
      .nav,
      .skip,
      .hero-note,
      .disclosure {
        display: none;
      }
      .masthead {
        min-height: 65px;
      }
      .hero {
        padding: 28px 0;
      }
      .hero h1 {
        font-size: 40px;
      }
      .metrics {
        margin-bottom: 25px;
      }
      .content-grid {
        display: block;
      }
      .sidebar {
        position: static;
        display: block;
        margin-top: 25px;
      }
      .side-card {
        break-inside: avoid;
      }
      .reader {
        box-shadow: none;
      }
      .document {
        padding: 25px;
        font-size: 13pt;
        line-height: 1.7;
      }
      .section {
        break-before: auto;
        margin-top: 30px;
      }
      .stage > summary,
      .section-head {
        break-after: avoid;
      }
      .raw-text {
        font-size: 8pt;
      }
      .receipt-details .raw-text {
        max-height: none;
        overflow: visible;
      }
      .footer {
        margin-top: 30px;
      }
      a {
        text-decoration: none;
      }
    }
  </style>
</head>
<body>
  <a class="skip" href="#final-document">Skip to the final document</a>
  <div class="shell">
    <header class="masthead">
      <div class="brand"><span class="mark" aria-hidden="true">rn</span><span>reword_nerd<span class="brand-dot">.</span></span></div>
      <span class="eyebrow">The local companion · Review edition</span>
      <nav class="nav" aria-label="Report sections"><a href="#final-document">Document</a><a href="#process">Process</a><a href="#receipt">Receipt</a></nav>
    </header>
    <main>
      <section class="hero" aria-labelledby="report-title">
        <div>
          <span class="status">${hasFinal ? 'Ready for your review' : 'Work in progress'}</span>
          <h1 id="report-title">${hasFinal ? 'The words are ready.<br><em>The last word is yours.</em>' : 'Good words<br><em>take a little process.</em>'}</h1>
          <p class="lede"><span class="filename">${escapeHtml(documentName)}</span><br>${hasFinal ? 'Your final document, the original source, and the work behind every stage — together in one local review.' : 'Follow the recorded stages below. A final document will appear when the final response has been supplied and exported.'}</p>
        </div>
        <div class="hero-note"><span class="tiny-label">An artifact, ready to inspect</span>Read the document. Check the source. Open the stage history when you need the details. Publication remains your decision.</div>
      </section>
      <section class="metrics" aria-label="Document and workflow counts">
        <div class="metric"><span class="tiny-label">Source words</span><strong>${number(sourceWords)}</strong><small>From the supplied source text</small></div>
        <div class="metric"><span class="tiny-label">Final words</span><strong>${hasFinal ? number(finalWords) : '—'}</strong><small>${escapeHtml(deltaLabel)}</small></div>
        <div class="metric"><span class="tiny-label">Stage responses</span><div class="progress" aria-hidden="true">${stages.map((stage) => `<span${stage.response.trim() ? ' class="complete"' : ''}></span>`).join('')}</div><strong class="progress-count">${number(completedStages)} of ${number(stages.length)} recorded</strong><small>Recorded responses are not approval</small></div>
      </section>
      <div class="content-grid">
        <div class="main-column">
          <section class="reader" id="final-document" aria-labelledby="document-heading" tabindex="-1">
            <div class="reader-top"><h2 id="document-heading">${hasFinal ? 'Final document' : 'Final document pending'}</h2><span>${hasFinal ? 'Plain-text reading view' : 'Awaiting the final stage'}</span></div>
            <div class="document${hasFinal ? '' : ' pending'}">${escapeHtml(hasFinal ? finalText : 'There is no final document in this export yet.\nThe stage history below shows the responses recorded so far.')}</div>
            <p class="reader-foot">${hasFinal ? 'This view preserves the supplied final text, including any Markdown notation. Raw stage responses and prompts are separated below.' : 'Progress can be reviewed without a final document. This export does not manufacture missing stage output.'}</p>
          </section>
          <section class="section" aria-labelledby="source-heading">
            <div class="section-head"><div><h2 id="source-heading">Keep the source close.</h2><p>The source text is available for checking meaning, names, evidence, and details.</p></div><span class="tiny-label">${number(sourceWords)} words</span></div>
            <details class="source-details"><summary><span>Read the original source text</span><span class="disclosure" aria-hidden="true">+</span></summary><div class="source-text">${escapeHtml(sourceText || 'No source text was included in this report.')}</div></details>
          </section>
          <section class="section" id="process" aria-labelledby="process-heading">
            <div class="section-head"><div><h2 id="process-heading">Nothing lost between drafts.</h2><p>Open a stage to inspect its task prompt and exact recorded response. These are audit materials, separate from the final document.</p></div><span class="tiny-label">The process</span></div>
            ${stages.length ? stages.map(renderStage).join('\n') : '<p class="local-note">No stage history was included in this report.</p>'}
          </section>
          <section class="section" id="receipt" aria-labelledby="receipt-heading">
            <div class="section-head"><div><h2 id="receipt-heading">A record you can keep.</h2><p>The supplied receipt records this export's identity and provenance. Inspect its fields before relying on any execution claim.</p></div></div>
            <details class="receipt-details"><summary><span>Inspect the machine-readable receipt</span><span class="disclosure" aria-hidden="true">+</span></summary><pre class="raw-text">${escapeHtml(serializedReceipt)}</pre></details>
            <p class="receipt-foot">The source package is retained separately. The job, response files, and exported artifacts remain on local disk until you remove them. Opening this report makes no network requests.</p>
          </section>
        </div>
        <aside class="sidebar" aria-label="Run provenance and retention">
          <section class="side-card"><span class="mode-badge mode-${execution.kind}">${escapeHtml(execution.label)}</span><h2>The context<br>behind the words.</h2><p>${escapeHtml(execution.description)}</p><dl class="facts">${host ? `<div><dt>Reported host</dt><dd>${escapeHtml(host)}</dd></div>` : ''}${model ? `<div><dt>Reported model</dt><dd>${escapeHtml(model)}</dd></div>` : ''}${jobId ? `<div><dt>Job identity</dt><dd>${escapeHtml(jobId)}</dd></div>` : ''}${exportedAt ? `<div><dt>Recorded timestamp</dt><dd>${escapeHtml(exportedAt)}</dd></div>` : ''}<div><dt>Review status</dt><dd>${hasFinal ? 'Awaiting your review' : 'Incomplete workflow'}</dd></div></dl></section>
          <p class="local-note"><strong>Local files. Deliberate handoff.</strong><br>This companion report is a separate artifact. It does not change the manual website workflow or approve the result. Keep or remove the job files according to your needs.</p>
        </aside>
      </div>
    </main>
    <footer class="footer"><span>Good ideas deserve better words.<br>Review the result before you use it.</span><span>reword_nerd · local companion</span></footer>
  </div>
</body>
</html>`;
}
