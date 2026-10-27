import { base64 as toBase64, unbase64, type ReviewRuntime } from "./runtime";
import { createPngInspector, PNG_LIMITS } from "./png";

export interface ImageReviewAttempt {
  attempt: number;
  revision: number;
  ticketId: string;
  status: string;
  resultSha256?: string;
  resultBase64?: string;
  width?: number;
  height?: number;
  reason?: string;
  executor?: string;
  model?: string | null;
}

export interface ImageReviewModel {
  jobId: string;
  packageSha256: string;
  pairKey: string;
  displayName: string;
  prompt: string;
  promptSha256: string;
  referenceSha256: string;
  referenceBase64: string;
  width: number;
  height: number;
  execution: { mode: string; host?: string | null; model?: string | null };
  attempts: ImageReviewAttempt[];
  currentTicketId: string | null;
  retainedRegistration?: { id: string; validator: string };
}

export function createReviewRenderer(runtime:ReviewRuntime){
const inspectPng=createPngInspector(runtime);
const escape = (value: unknown): string =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const metadata = (value: string | null | undefined): string =>
  value?.trim() ? value : "Unknown";
const count = (value: number): string =>
  Number.isSafeInteger(value) && value >= 0 ? String(value) : "Unknown";
/** Validate supported PNG bytes before using their exact base64 in an image or download. */
function pngData(
  base64: string | undefined,
  width: number | undefined,
  height: number | undefined,
): string | null {
  if (
    !base64 ||
    base64.length > Math.ceil(PNG_LIMITS.bytes / 3) * 4 ||
    base64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
  )
    return null;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height))
    return null;
  try {
    const bytes = unbase64(base64);
    if (toBase64(bytes) !== base64) return null;
    const image = inspectPng(bytes);
    if (image.width !== width || image.height !== height) return null;
    return "data:image/png;base64," + base64;
  } catch {
    return null;
  }
}

function executionCopy(mode: string): {
  label: string;
  description: string;
  fixture: boolean;
} {
  if (mode === "fixture")
    return {
      label: "Fixture demonstration",
      fixture: true,
      description:
        "These images demonstrate the local workflow using a fixture. This is not evidence of a live image generation run.",
    };
  if (mode === "host" || mode === "host-assisted")
    return {
      label: "Reported host run",
      fixture: false,
      description:
        "Preparation metadata is declared before execution. Executor names attached to recorded results are reported separately; this file does not independently verify them or judge the result.",
    };
  return {
    label: "Execution provenance not verified",
    fixture: false,
    description:
      "The reported execution mode is shown in Run details. Do not infer a live model run or an accepted result from this review.",
  };
}

function digest(label: string, value: string | null | undefined): string {
  return `<div class="digest"><dt>${escape(label)}</dt><dd><code>${escape(metadata(value))}</code></dd></div>`;
}

function resultFigure(
  attempt: ImageReviewAttempt,
  index: number,
  selected: number,
  retained = false,
): string {
  const data = pngData(attempt.resultBase64, attempt.width, attempt.height);
  const hasBytes = Boolean(attempt.resultBase64);
  return `<section class="result-attempt" data-attempt="${index}" ${index === selected ? "" : "hidden"} aria-label="Revision ${count(attempt.revision)}, attempt ${count(attempt.attempt)}">
    <div class="image-stage">${
      data
        ? `<img src="${data}" alt="${retained ? "Retained host output" : "Recorded result"}, revision ${count(attempt.revision)}, attempt ${count(attempt.attempt)}" width="${count(attempt.width!)}" height="${count(attempt.height!)}" decoding="async">`
        : `<div class="empty-image"><span class="empty-mark" aria-hidden="true">${hasBytes ? "!" : "↗"}</span><h3>${hasBytes ? "Image could not be displayed" : "No image recorded for this attempt"}</h3><p>${hasBytes ? "The supplied image failed the PNG validation or dimension checks. Consult the raw run artifacts before continuing." : "This review preserves the attempt state. An older image is not substituted for a missing result."}</p></div>`
    }</div>
    <div class="figure-meta"><span>Revision ${count(attempt.revision)} · attempt ${count(attempt.attempt)}<small>Recorded status: ${escape(metadata(attempt.status))}</small></span>${data ? `<a class="file-link" href="${data}" download="result-r${count(attempt.revision)}-a${count(attempt.attempt)}.png">Download exact PNG <span aria-hidden="true">↙</span></a>` : ""}</div>
    ${attempt.reason ? `<p class="attempt-reason">${escape(attempt.reason)}</p>` : ""}
    <dl class="result-digest">${digest("Result SHA-256 · reported", attempt.resultSha256)}${digest("Executor · reported for this attempt", attempt.executor)}${digest("Model · reported for this attempt", attempt.model)}</dl>
  </section>`;
}

const SCRIPT = `(() => {
  const selector = document.getElementById('attempt-select');
  const status = document.getElementById('selection-status');
  if (selector) selector.addEventListener('change', () => {
    document.querySelectorAll('[data-attempt]').forEach(panel => { panel.hidden = panel.dataset.attempt !== selector.value; });
    status.textContent = 'Showing ' + selector.options[selector.selectedIndex].text + '. Review required.';
  });
  const comparison = document.getElementById('comparison');
  document.querySelectorAll('button[data-layout]').forEach(button => button.addEventListener('click', () => {
    comparison.dataset.layout = button.dataset.layout;
    document.querySelectorAll('button[data-layout]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  }));
  const notes = document.getElementById('review-notes');
  const notesStatus = document.getElementById('notes-status');
  const save = document.getElementById('download-notes');
  save.addEventListener('click', () => {
    const text = ['Image review notes', 'Job: ' + document.getElementById('job-id').textContent, 'Selection: ' + (selector ? selector.options[selector.selectedIndex].text : 'No recorded attempts'), 'Review notes only. These notes do not record acceptance in the runner.', '', notes.value].join('\\n');
    const url = URL.createObjectURL(new Blob([text], {type:'text/plain;charset=utf-8'}));
    const link = document.createElement('a'); link.href = url; link.download = 'image-review-notes.txt'; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notesStatus.textContent = 'Notes download requested. Confirm that the file was saved before closing this page.';
  });
  notes.addEventListener('input', () => { notesStatus.textContent = 'Unsaved notes · held in this page only.'; });
})();`;

const STYLES = `
:root{color-scheme:dark;--bg:#131b23;--panel:#18232b;--raised:#24333e;--text:#eaf0f3;--muted:#a6b7c1;--line:#334652;--accent:#9bd7ed;--ink:#142934;--paper:#f0efe5;--warn:#eec88c}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--text);font:13px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:var(--accent);text-underline-offset:4px}button,select,textarea{font:inherit}button,select{min-height:38px;border:1px solid var(--line);border-radius:7px;background:var(--panel);color:var(--text);padding:8px 12px}button{cursor:pointer}button:hover,a:hover{filter:brightness(1.12)}button:focus-visible,a:focus-visible,summary:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--accent);outline-offset:4px}[hidden]{display:none!important}.skip{position:absolute;top:-70px;left:15px;padding:10px 15px;background:var(--accent);color:var(--ink);z-index:10}.skip:focus{top:10px}
.masthead{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:22px 32px;border-bottom:1px solid var(--line);background:var(--panel)}.brand{display:flex;align-items:center;gap:12px;font-size:20px;font-weight:650;letter-spacing:-.7px}.brand-mark{display:grid;place-items:center;width:36px;height:36px;color:var(--accent);border:1px solid var(--accent);border-radius:9px 9px 9px 0;font:italic 29px/1 Georgia,serif}.masthead nav{display:flex;gap:24px;flex-wrap:wrap;font-size:11px}.masthead nav a{color:var(--muted);text-decoration:none}.local-band{display:flex;justify-content:space-between;gap:12px;padding:8px 32px;border-bottom:1px solid var(--line);color:var(--muted);font-size:10px}.local-band span:first-child:before{content:"";display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--accent);margin-right:8px}
main{max-width:1720px;margin:auto}.intro{display:flex;align-items:end;justify-content:space-between;gap:28px;padding:38px 32px 30px}.eyebrow{font:9px/1.6 ui-monospace,monospace;text-transform:uppercase;letter-spacing:1.7px;color:var(--accent);margin:0 0 11px}h1{font:400 clamp(34px,4vw,54px)/1.12 Georgia,serif;letter-spacing:-1.5px;margin:0 0 12px}h1 em{color:var(--accent);font-weight:400}.intro p:not(.eyebrow){color:var(--muted);max-width:630px;margin:0;font-size:13px}.review-badge{border:1px solid var(--line);border-radius:6px;padding:8px 13px;color:var(--accent);white-space:nowrap;font-size:11px}.provenance{margin:0 32px 30px;padding:16px 20px;display:flex;gap:24px;border:1px solid var(--line);border-left:3px solid var(--accent);background:var(--panel);border-radius:7px}.provenance strong{flex:0 0 185px;font-size:12px}.provenance p{margin:0;color:var(--muted);font-size:12px}.provenance.fixture{border-left-color:var(--warn)}.provenance.fixture strong{color:var(--warn)}
.workspace{display:grid;grid-template-columns:minmax(0,1fr) 300px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.comparison-area{min-width:0;padding:28px 30px 34px}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:20px}h2{font-size:17px;font-weight:600;line-height:1.35;margin:0}h3{font-size:13px;font-weight:600;margin:0 0 8px}.view-options{display:flex;gap:5px}.view-options button{font-size:11px;min-height:34px;padding:6px 10px}.view-options button[aria-pressed=true]{border-color:var(--accent);background:var(--raised);color:var(--accent)}.comparison{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px;align-items:start}.comparison[data-layout=stack]{grid-template-columns:1fr}.image-card{min-width:0;border:1px solid var(--line);border-radius:9px;overflow:hidden;background:var(--panel)}.card-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 17px;border-bottom:1px solid var(--line)}.card-heading h3{margin:0}.card-heading span{font-size:10px;color:var(--muted)}.attempt-control{display:grid;gap:7px;margin:0 0 18px;padding:12px 17px;border:1px solid var(--line);border-radius:7px;background:var(--panel)}.attempt-control label{font-size:10px;color:var(--muted)}.attempt-control select{width:100%;min-width:0;font-size:11px}.image-stage{display:grid;place-items:center;min-height:280px;padding:14px;background:var(--paper);overflow:hidden}.image-stage img{display:block;max-width:100%;height:auto;max-height:680px;object-fit:contain}.figure-meta{display:flex;align-items:start;justify-content:space-between;gap:15px;padding:14px 17px;font-size:11px}.figure-meta>span{min-width:0;overflow-wrap:anywhere}.figure-meta small{display:block;color:var(--muted);font-size:10px;margin-top:3px}.file-link{font-size:10px;text-align:right}.empty-image{color:#293842;text-align:center;padding:36px 16px;max-width:370px}.empty-image p{font-size:12px;line-height:1.7;color:#606d75;margin:0}.empty-mark{display:block;font:italic 42px Georgia,serif;color:#28657b;margin-bottom:12px}.result-digest{margin:0;padding:0 17px 17px}.digest{min-width:0;margin:0 0 13px}.digest:last-child{margin-bottom:0}.digest dt{font-size:10px;color:var(--muted);margin-bottom:4px}.digest dd{margin:0;min-width:0}.digest code{display:block;font:10px/1.65 ui-monospace,monospace;overflow-wrap:anywhere;word-break:break-all}.attempt-reason{padding:0 17px;color:var(--warn);font-size:11px;white-space:pre-wrap;overflow-wrap:anywhere}.comparison-note{color:var(--muted);font-size:11px;margin:18px 0 0}.selection-status{min-height:18px;color:var(--muted);font-size:10px;margin:12px 0 0}
.run-details{padding:29px 24px;border-left:1px solid var(--line);background:var(--panel);min-width:0}.run-details h2{margin-bottom:23px}.detail-list{margin:0}.detail-list>div{margin:0 0 17px}.detail-list dt{font-size:10px;color:var(--muted);margin-bottom:4px}.detail-list dd{margin:0;font-size:12px;overflow-wrap:anywhere}.details-divider{border:0;border-top:1px solid var(--line);margin:23px 0}.history{list-style:none;margin:0;padding:0}.history li{border-left:1px solid var(--line);padding:0 0 22px 15px;position:relative}.history li:before{content:"";width:5px;height:5px;border-radius:50%;background:var(--muted);position:absolute;left:-3px;top:7px}.history li.current:before{background:var(--accent)}.history strong{font-size:11px;display:block;font-weight:500}.history small{display:block;font-size:10px;color:var(--muted);overflow-wrap:anywhere}.history .current-label{color:var(--accent)}.history details{margin-top:5px}.history summary{font-size:10px;color:var(--muted);cursor:pointer}.history code{font:9px/1.6 ui-monospace,monospace;overflow-wrap:anywhere}.history p{font-size:11px;color:var(--warn);overflow-wrap:anywhere}
.review-material{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:35px;padding:32px}.prompt-details{min-width:0}.prompt-details>summary{cursor:pointer;display:list-item;font-size:17px;font-weight:600;padding:0 0 12px}.prompt-details .digest{margin-top:10px}pre{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;font:12px/1.8 ui-monospace,monospace;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:22px;max-height:600px;overflow:auto;margin:16px 0 0}.notes{min-width:0}.notes h2{margin-bottom:8px}.notes label,.notes p{display:block;color:var(--muted);font-size:11px;margin:0 0 12px}.notes textarea{display:block;width:100%;min-height:130px;resize:vertical;background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:7px;padding:12px;margin-bottom:10px}.notes button{background:var(--accent);border-color:var(--accent);color:var(--ink);font-size:11px;font-weight:600}.notes .notes-status{font-size:10px;margin-top:10px;min-height:18px}.footer{display:flex;justify-content:space-between;gap:20px;padding:20px 32px;border-top:1px solid var(--line);color:var(--muted);font-size:10px}.footer p{margin:0}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(max-width:1100px){.workspace{grid-template-columns:1fr}.run-details{border-left:0;border-top:1px solid var(--line);display:grid;grid-template-columns:1fr 1fr;gap:30px}.run-details .details-divider{display:none}.review-material{grid-template-columns:minmax(0,1fr) 310px}}@media(max-width:700px){.masthead{padding:18px;flex-wrap:wrap;gap:16px}.masthead nav{gap:18px}.local-band{padding:8px 18px}.local-band span:last-child{display:none}.intro{padding:29px 18px 22px;display:block}.review-badge{display:inline-block;margin-top:20px}.provenance{margin:0 18px 24px;display:block;padding:14px 16px}.provenance strong{display:block;margin-bottom:6px}.comparison-area{padding:23px 18px}.comparison{grid-template-columns:1fr}.section-heading{align-items:start;gap:14px;flex-wrap:wrap}.image-stage{min-height:230px}.run-details{padding:25px 18px;display:block}.run-details .details-divider{display:block}.review-material{display:block;padding:28px 18px}.notes{margin-top:30px}.footer{padding:18px;flex-wrap:wrap}.image-stage img{max-height:540px}.brand{font-size:19px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}@media print{body{background:white;color:#263742}.masthead,.local-band,.view-options,.notes,.file-link{display:none}.workspace,.comparison,.review-material,.run-details{display:block}.image-card{break-inside:avoid;margin-bottom:20px}.result-attempt[hidden]{display:none!important}.run-details{border:0}.prompt-details pre{max-height:none}.provenance{break-inside:avoid}}
`;

function renderImageReview(model: ImageReviewModel): string {
  const reference = pngData(model.referenceBase64, model.width, model.height);
  const provenance = executionCopy(model.execution.mode);
  const current =
    model.currentTicketId === null
      ? -1
      : model.attempts.findIndex(
          (attempt) => attempt.ticketId === model.currentTicketId,
        );
  const selected =
    current >= 0
      ? current
      : model.currentTicketId === null
        ? model.attempts.length - 1
        : -1;
  const options = model.attempts
    .map(
      (attempt, index) =>
        `<option value="${index}" ${index === selected ? "selected" : ""}>Revision ${count(attempt.revision)} · attempt ${count(attempt.attempt)} · ${escape(metadata(attempt.status))}${attempt.ticketId === model.currentTicketId ? " · current ticket" : " · history"}</option>`,
    )
    .join("");
  const history = model.attempts.length
    ? model.attempts
        .map(
          (attempt) =>
            `<li class="${attempt.ticketId === model.currentTicketId ? "current" : ""}"><strong>Revision ${count(attempt.revision)} · attempt ${count(attempt.attempt)}</strong><small>Recorded status: ${escape(metadata(attempt.status))}</small>${attempt.ticketId === model.currentTicketId ? '<small class="current-label">Current ticket · review required</small>' : "<small>Historical attempt</small>"}<details><summary>Ticket and result hash</summary><code>${escape(attempt.ticketId)}</code><p class="sr-only">Result SHA-256</p><code>${escape(metadata(attempt.resultSha256))}</code>${attempt.reason ? `<p>${escape(attempt.reason)}</p>` : ""}</details></li>`,
        )
        .join("")
    : "<li><strong>No attempts recorded</strong><small>The source and task prompt are ready for inspection.</small></li>";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'"><title>${escape(model.displayName)} · Image review · reword_nerd</title><style>${STYLES}</style></head>
<body><a class="skip" href="#review">Skip to image comparison</a><header class="masthead"><div class="brand"><span class="brand-mark" aria-hidden="true">rn</span>reword_nerd.</div><nav aria-label="Review sections"><a href="#review">Comparison</a><a href="#run-details">Run details</a><a href="#prompt">Task prompt</a></nav></header><div class="local-band"><span>Self-contained local review</span><span>Source, recorded results, and audit details</span></div>
<main><section class="intro"><div><p class="eyebrow">Reference → recorded result → your review</p><h1>Review image output.</h1><p>${escape(model.displayName)} · Compare the reference with each recorded attempt, then inspect the prompt and run details.</p></div><span class="review-badge">User review required</span></section>
<aside class="provenance ${provenance.fixture ? "fixture" : ""}" aria-label="Execution provenance"><strong>${provenance.label}</strong><p>${provenance.description}</p></aside>
${model.retainedRegistration ? `<aside class="provenance" aria-label="Offline registration"><strong>Offline retained-output registration</strong><p>Registration ${escape(model.retainedRegistration.id)} · awaiting user review. The original host attempt remains failed. These previously returned bytes are registered separately; no new image was generated. Validator: ${escape(model.retainedRegistration.validator)}. Original receipts and failure history are preserved. <a href="./registration.json">Registration record</a> · <a href="./audit.json">Audit</a></p></aside>` : ""}
<div class="workspace"><section class="comparison-area" id="review" tabindex="-1" aria-labelledby="comparison-title"><div class="section-heading"><h2 id="comparison-title">Reference &amp; result</h2><div class="view-options" role="group" aria-label="Comparison layout"><button type="button" data-layout="side" aria-pressed="true">Side by side</button><button type="button" data-layout="stack" aria-pressed="false">Stacked</button></div></div>
${model.attempts.length ? `<div class="attempt-control"><label for="attempt-select">Choose a recorded attempt</label><select id="attempt-select">${selected === -1 ? '<option value="-1" selected>Current ticket has no matching attempt</option>' : ""}${options}</select></div>` : ""}<div class="comparison" id="comparison" data-layout="side"><article class="image-card"><header class="card-heading"><h3>Original reference</h3><span>Exact supplied PNG</span></header><div class="image-stage">${reference ? `<img src="${reference}" alt="Original reference: ${escape(model.displayName)}" width="${count(model.width)}" height="${count(model.height)}" decoding="async">` : '<div class="empty-image"><span class="empty-mark" aria-hidden="true">!</span><h3>Reference image unavailable</h3><p>The supplied reference failed the PNG validation or dimension checks. The audit details remain available below.</p></div>'}</div><div class="figure-meta"><span>${count(model.width)} × ${count(model.height)} pixels<small>Embedded bytes preserved without conversion</small></span>${reference ? `<a class="file-link" href="${reference}" download="reference.png">Download exact PNG <span aria-hidden="true">↙</span></a>` : ""}</div><dl class="result-digest">${digest("Reference SHA-256 · reported", model.referenceSha256)}</dl></article>
<article class="image-card"><header class="card-heading"><h3>${model.retainedRegistration ? "Retained host output" : "Recorded result"}</h3><span>${provenance.fixture ? "Fixture output" : "Review required"}</span></header>${selected === -1 ? '<section data-attempt="-1"><div class="image-stage"><div class="empty-image"><span class="empty-mark" aria-hidden="true">↗</span><h3>No current result to display</h3><p>Inspect the source and prompt while the run is pending. Any historical attempts remain separately selectable.</p></div></div></section>' : ""}${model.attempts.map((attempt, index) => resultFigure(attempt, index, selected, Boolean(model.retainedRegistration))).join("")}</article></div><p class="comparison-note">These previews fit the available space. Download the exact PNG files to inspect native pixels. Recording an image does not establish quality, correctness, or acceptance.</p><p class="selection-status" id="selection-status" role="status" aria-live="polite">${selected >= 0 ? `Showing ${current >= 0 ? "the current ticket" : "the latest historical attempt"}. User review required.` : "No current result selected. User review required."}</p></section>
<aside class="run-details" id="run-details" aria-label="Run details"><div><p class="eyebrow">Run details</p><h2>Run details.</h2><dl class="detail-list"><div><dt>${model.retainedRegistration ? "Origin job" : "Job"}</dt><dd id="job-id">${escape(model.jobId)}</dd></div><div><dt>Pair key</dt><dd>${escape(model.pairKey)}</dd></div><div><dt>Execution mode · reported</dt><dd>${escape(metadata(model.execution.mode))}</dd></div><div><dt>Host · declared at preparation</dt><dd>${escape(metadata(model.execution.host))}</dd></div><div><dt>Model · declared at preparation</dt><dd>${escape(metadata(model.execution.model))}</dd></div><div><dt>Current ticket</dt><dd>${escape(model.currentTicketId ?? "None")}</dd></div></dl><dl>${digest("Package SHA-256 · reported", model.packageSha256)}</dl></div><hr class="details-divider"><div><h2>${model.retainedRegistration ? "Original attempt history" : "Attempt history"}</h2><ol class="history">${history}</ol></div></aside></div>
<section class="review-material" aria-label="Prompt and review notes"><details class="prompt-details" id="prompt"><summary>Read the exact task prompt</summary><dl>${digest("Prompt SHA-256 · reported", model.promptSha256)}</dl><p><a href="./saved-configuration.json" download="saved-configuration.json">Download saved prompt configuration ↙</a></p><p>Existing saved profile and prompt configuration. This does not authenticate a provider or establish the executor’s identity.</p><pre>${escape(model.prompt)}</pre></details><section class="notes" aria-labelledby="notes-title"><h2 id="notes-title">Your review notes</h2><label for="review-notes">Record what to keep, change, or check. Notes stay in this page until you download them.</label><textarea id="review-notes" placeholder="What works? What needs another pass?"></textarea><button id="download-notes" type="button">Download notes <span aria-hidden="true">↙</span></button><p class="notes-status" id="notes-status" role="status" aria-live="polite">Notes are separate from the run. They do not mark an image accepted.</p></section></section></main>
<footer class="footer"><p>reword_nerd / local image review</p><p>Keep the exported files. Final acceptance remains yours.</p></footer><script>${SCRIPT}</script></body></html>`;
}

return renderImageReview;
}
