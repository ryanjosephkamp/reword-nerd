import { useEffect, useState } from "react";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

let rendererPromise: Promise<(markdown: string) => string> | undefined;

// Documents are shown, never run: pictures become labeled placeholders (so nothing is fetched
// from the network), raw HTML is shown as text, and the result is sanitized as a second guard.
function loadRenderer() {
  rendererPromise ??= Promise.all([import("marked"), import("dompurify")]).then(
    ([{ Marked }, { default: purify }]) => {
      const marked = new Marked({
        gfm: true,
        async: false,
        renderer: {
          image: ({ text }) =>
            `<span class="figure-ref">[Figure${text ? `: ${escapeHtml(text)}` : ""}]</span>`,
          html: ({ text }) => escapeHtml(text),
        },
      });
      purify.addHook("afterSanitizeAttributes", (node) => {
        if (node.tagName === "A") {
          node.setAttribute("target", "_blank");
          node.setAttribute("rel", "noopener noreferrer");
        }
      });
      return (markdown: string) =>
        purify.sanitize(marked.parse(markdown) as string, {
          FORBID_TAGS: ["img", "picture", "source", "video", "audio", "iframe", "style", "form"],
          FORBID_ATTR: ["style", "srcset"],
        });
    },
  );
  return rendererPromise;
}

/** Renders Markdown as inert, sanitized HTML. The parser loads on first use. */
export function MarkdownView({
  markdown,
  className = "",
}: {
  markdown: string;
  className?: string;
}) {
  const [rendered, setRendered] = useState<{ source: string; html: string } | null>(null);
  useEffect(() => {
    let current = true;
    loadRenderer().then((render) => {
      if (current) setRendered({ source: markdown, html: render(markdown) });
    });
    return () => {
      current = false;
    };
  }, [markdown]);
  if (rendered?.source !== markdown) {
    return <pre className={`plain-view ${className}`}>{markdown}</pre>;
  }
  return (
    <div className={`prose ${className}`} dangerouslySetInnerHTML={{ __html: rendered.html }} />
  );
}
