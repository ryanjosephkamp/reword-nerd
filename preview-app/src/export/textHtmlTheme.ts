export const TEXT_HTML_THEME_CSS = `
:root{--canvas:#090b10;--surface:#11151f;--deep:#080a0f;--border:#374151;--border-soft:#2a3444;--text:#f5f7fb;--muted:#b5bdc9;--accent:#42e8b4;--accent-ink:#06130f;--warning:#f2b84b;color-scheme:dark;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
*{box-sizing:border-box}
body{margin:0;padding:clamp(16px,4vw,48px);background:var(--canvas);color:var(--text);line-height:1.55}
main{width:min(1120px,100%);margin:0 auto}
h1,h2,h3,p,li,code{overflow-wrap:anywhere}
h1{margin:.1em 0 .35em;font-size:clamp(1.8rem,6vw,3rem);line-height:1.08}
h2{margin-top:0}
a:link,a:visited{color:var(--accent);text-underline-offset:3px;overflow-wrap:anywhere}
a:focus-visible,button:focus-visible,textarea:focus-visible,pre:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
.package-header{margin-bottom:24px}
.eyebrow{margin:0 0 10px;color:var(--accent);font-weight:800;letter-spacing:.1em}
.intro{max-width:76ch;color:var(--muted)}
.workbook-card,.root-card{min-width:0;margin-top:20px;border:1px solid var(--border);background:var(--surface);padding:clamp(14px,3vw,24px)}
code,pre,textarea{font-family:inherit}
@media(max-width:420px){body{padding:12px}.workbook-card,.root-card{padding:12px}}
`;
