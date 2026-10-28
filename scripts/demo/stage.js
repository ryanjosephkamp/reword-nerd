// Injected into the page while recording the demo: a visible cursor, a file "chip" that follows
// it during drags, and a terminal window for the agent's run. The terminal is labeled as a
// simulation on screen, because the demo never calls a model.
(() => {
  const css = `
  #demo-cursor { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none;
    margin: 0; padding: 0; border: 0; background: none; overflow: visible; inset: auto;
    width: 24px; height: 28px; transform: translate(-200px, -200px); }
  .demo-ripple { position: fixed; z-index: 2147483646; width: 34px; height: 34px; margin: -17px 0 0 -17px;
    border: 2px solid rgb(255 255 255 / 0.9); border-radius: 50%; pointer-events: none;
    animation: demo-ripple 0.45s ease-out forwards; }
  @keyframes demo-ripple { from { transform: scale(0.3); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }
  .demo-chip { position: fixed; z-index: 2147483645; display: flex; align-items: center; gap: 8px;
    padding: 8px 12px; border-radius: 8px; background: #f5f7f8; color: #17232b;
    font: 600 13px/1.2 system-ui, -apple-system, sans-serif; box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
    pointer-events: none; transition: opacity 0.25s ease; }
  .demo-chip svg { width: 18px; height: 18px; }
  .demo-terminal { position: fixed; z-index: 2147483640; left: 50%; top: 50%; width: 820px;
    transform: translate(-50%, -46%) scale(0.98); opacity: 0; border-radius: 12px; overflow: hidden;
    background: #0e1418; color: #d7e0e5; box-shadow: 0 30px 80px rgb(0 0 0 / 0.55);
    border: 1px solid #2b3942; transition: opacity 0.3s ease, transform 0.3s ease;
    font: 14px/1.6 ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
  .demo-terminal.open { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  .demo-terminal header { display: flex; align-items: center; gap: 8px; padding: 10px 14px;
    background: #172129; color: #93a4ae; font: 600 12px/1 system-ui, -apple-system, sans-serif; }
  .demo-terminal header i { width: 12px; height: 12px; border-radius: 50%; background: #3b4a54; }
  .demo-terminal header span { margin-left: 8px; }
  .demo-terminal header b { margin-left: auto; padding: 3px 8px; border-radius: 999px;
    background: #2a3640; color: #c9d5db; font-weight: 600; }
  .demo-terminal pre { min-height: 300px; margin: 0; padding: 16px 18px 20px; white-space: pre-wrap;
    word-break: break-all; font: inherit; }
  .demo-terminal .dim { color: #7f929d; }
  .demo-terminal .ok { color: #8fd19e; }
  .demo-terminal .caret { display: inline-block; width: 8px; height: 16px; margin-bottom: -3px;
    background: #d7e0e5; animation: demo-blink 1s steps(1) infinite; }
  @keyframes demo-blink { 50% { opacity: 0; } }
  .demo-backdrop { position: fixed; inset: 0; z-index: 2147483639; background: rgb(4 8 10 / 0.45);
    opacity: 0; transition: opacity 0.3s ease; pointer-events: none; }
  .demo-backdrop.open { opacity: 1; }`;

  const ICONS = {
    file: '<svg viewBox="0 0 256 256" fill="#1e6784"><path d="M213.66,82.34l-56-56A8,8,0,0,0,152,24H56A16,16,0,0,0,40,40V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V88A8,8,0,0,0,213.66,82.34ZM160,51.31,188.69,80H160ZM200,216H56V40h88V88a8,8,0,0,0,8,8h48V216Z"/></svg>',
    folder:
      '<svg viewBox="0 0 256 256" fill="#b07a1e"><path d="M216,72H131.31L104,44.69A15.86,15.86,0,0,0,92.69,40H40A16,16,0,0,0,24,56V200.62A15.4,15.4,0,0,0,39.38,216H216.89A15.13,15.13,0,0,0,232,200.89V88A16,16,0,0,0,216,72ZM40,56H92.69l16,16H40Z"/></svg>',
  };

  function setup() {
    if (document.getElementById("demo-cursor")) return;
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    const cursor = document.createElement("div");
    cursor.id = "demo-cursor";
    cursor.innerHTML =
      '<svg width="24" height="28" viewBox="0 0 24 28"><path d="M3 2 L3 21 L8 16.5 L11.6 24.5 L14.8 23.1 L11.3 15.4 L18.4 15.4 Z" fill="#fff" stroke="#0b1114" stroke-width="1.7" stroke-linejoin="round"/></svg>';
    if ("popover" in HTMLElement.prototype) cursor.popover = "manual";
    document.body.append(cursor);
    if (cursor.showPopover) cursor.showPopover();
    let chip = null;
    let terminal = null;
    let backdrop = null;
    addEventListener(
      "mousemove",
      (event) => {
        cursor.style.transform = `translate(${event.clientX - 3}px, ${event.clientY - 2}px)`;
        if (chip) {
          chip.style.left = `${event.clientX + 14}px`;
          chip.style.top = `${event.clientY + 12}px`;
        }
      },
      true,
    );
    addEventListener(
      "mousedown",
      (event) => {
        const ripple = document.createElement("div");
        ripple.className = "demo-ripple";
        ripple.style.left = `${event.clientX}px`;
        ripple.style.top = `${event.clientY}px`;
        document.body.append(ripple);
        setTimeout(() => ripple.remove(), 500);
      },
      true,
    );
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    window.__demo = {
      // Keeps the cursor above menus, which open in the browser's top layer.
      raise() {
        if (cursor.hidePopover) {
          cursor.hidePopover();
          cursor.showPopover();
        }
      },
      chip(label, kind, x, y) {
        chip = document.createElement("div");
        chip.className = "demo-chip";
        chip.innerHTML = `${ICONS[kind]}<span></span>`;
        chip.querySelector("span").textContent = label;
        chip.style.left = `${x + 14}px`;
        chip.style.top = `${y + 12}px`;
        document.body.append(chip);
      },
      async dropChip() {
        if (!chip) return;
        const current = chip;
        chip = null;
        current.style.opacity = "0";
        await sleep(250);
        current.remove();
      },
      async openTerminal() {
        backdrop = document.createElement("div");
        backdrop.className = "demo-backdrop";
        terminal = document.createElement("section");
        terminal.className = "demo-terminal";
        terminal.innerHTML =
          '<header><i></i><i></i><i></i><span>Terminal</span><b>Simulated agent run</b></header><pre><span class="dim">$ </span><span class="typed"></span><span class="caret"></span></pre>';
        document.body.append(backdrop, terminal);
        await sleep(30);
        backdrop.classList.add("open");
        terminal.classList.add("open");
        this.raise();
        await sleep(350);
      },
      async type(text, perSecond = 70) {
        const typed = terminal.querySelector(".typed");
        for (let at = 0; at < text.length; at += 3) {
          typed.textContent = text.slice(0, at + 3);
          await sleep(3000 / perSecond);
        }
      },
      async lines(entries) {
        const pre = terminal.querySelector("pre");
        pre.querySelector(".caret").remove();
        for (const [text, pause, mark] of entries) {
          await sleep(pause);
          const line = document.createElement("span");
          line.innerHTML = "\n";
          const body = document.createElement("span");
          body.textContent = text;
          line.append(body);
          if (mark) {
            const ok = document.createElement("span");
            ok.className = "ok";
            ok.textContent = `  ${mark}`;
            line.append(ok);
          }
          pre.append(line);
        }
        const prompt = document.createElement("span");
        prompt.innerHTML = '\n<span class="dim">$ </span><span class="caret"></span>';
        pre.append(prompt);
      },
      async closeTerminal() {
        terminal.classList.remove("open");
        backdrop.classList.remove("open");
        await sleep(320);
        terminal.remove();
        backdrop.remove();
      },
    };
  }
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", setup);
  else setup();
})();
