import { useEffect, useState } from "react";
import { loadMarkdown } from "./markdown";

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
    loadMarkdown().then((tools) => {
      if (current) setRendered({ source: markdown, html: tools.render(markdown) });
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
