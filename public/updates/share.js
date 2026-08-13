const CANONICAL_ORIGIN = "https://ryanjosephkamp.github.io";
const UPDATES_PATH = "/reword-nerd/updates/";

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === CANONICAL_ORIGIN
      && url.pathname.startsWith(UPDATES_PATH)
      && !url.search
      && !url.hash
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function announce(message) {
  const status = document.getElementById("share-status");
  if (status) status.textContent = message;
}

async function copyUrl(url) {
  if (globalThis.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(url);
      return true;
    } catch {
      // Continue to the selection-compatible browser fallback.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = url;
  textarea.readOnly = true;
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  try {
    return typeof document.execCommand === "function" && document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

function showManualUrl(url, trigger) {
  const backdrop = document.createElement("div");
  backdrop.className = "share-fallback-backdrop";
  const dialog = document.createElement("div");
  dialog.className = "share-fallback";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "Share link");
  const explanation = document.createElement("p");
  explanation.textContent = "Your browser could not copy this link automatically. Select it and copy it manually.";
  const field = document.createElement("textarea");
  field.value = url;
  field.readOnly = true;
  field.setAttribute("aria-label", "Share URL");
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  const dismiss = () => {
    document.removeEventListener("keydown", onKeydown);
    backdrop.remove();
    trigger.focus();
  };
  const onKeydown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      dismiss();
    } else if (event.key === "Tab") {
      event.preventDefault();
      (document.activeElement === field ? close : field).focus();
    }
  };
  close.addEventListener("click", dismiss);
  backdrop.addEventListener("click", (event) => { if (event.target === backdrop) dismiss(); });
  dialog.append(explanation, field, close);
  backdrop.append(dialog);
  document.body.append(backdrop);
  document.addEventListener("keydown", onKeydown);
  field.focus();
  field.select();
}

async function share(control) {
  const url = canonicalUrl(control.dataset.shareUrl ?? "");
  if (!url) return;
  const title = control.dataset.shareTitle ?? "reword-nerd Updates";
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title, url });
      announce("Link shared.");
      return;
    } catch (error) {
      if (typeof error === "object" && error !== null && error.name === "AbortError") return;
    }
  }
  if (await copyUrl(url)) {
    announce("Link copied.");
    return;
  }
  showManualUrl(url, control);
}

for (const control of document.querySelectorAll("button[data-share-url]")) {
  control.addEventListener("click", () => { void share(control); });
}
