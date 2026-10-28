import {
  ListBullets,
  ListNumbers,
  Quotes,
  TextB,
  TextItalic,
  type Icon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  assembleMarkdown,
  segmentTokens,
  type MarkdownSegments,
  type PageItem,
} from "../../engine/page/blocks";
import { detectConventions, escapeMarkdownText, loadConverter } from "../../engine/page/toMarkdown";
import { loadMarkdown, type MarkdownTools } from "../../ui/markdown";

interface Loaded {
  tools: MarkdownTools;
  convert: (node: HTMLElement) => string;
}

interface Rendered {
  segments: MarkdownSegments | null;
  baseline: string[];
}

const BLOCK_FORMATS = [
  { value: "p", label: "Paragraph" },
  { value: "h1", label: "Title" },
  { value: "h2", label: "Heading" },
  { value: "h3", label: "Subheading" },
] as const;

const INLINE: { command: string; label: string; shortcut: string; icon: Icon }[] = [
  { command: "bold", label: "Bold", shortcut: "⌘B", icon: TextB },
  { command: "italic", label: "Italic", shortcut: "⌘I", icon: TextItalic },
];

const BLOCKS: { command: string; value?: string; label: string; icon: Icon }[] = [
  { command: "insertUnorderedList", label: "Bulleted list", icon: ListBullets },
  { command: "insertOrderedList", label: "Numbered list", icon: ListNumbers },
  { command: "formatBlock", value: "blockquote", label: "Quote", icon: Quotes },
];

/** Puts the document on the page, one element per Markdown block, and remembers each one. */
function renderInto(root: HTMLElement, markdown: string, tools: MarkdownTools): Rendered {
  const normalized = markdown.replace(/\r\n?/g, "\n");
  const tokens = tools.lex(normalized);
  const exact = tokens.map((token) => token.raw).join("") === normalized;
  const segments = segmentTokens(tokens, /\r\n/.test(markdown));
  const template = document.createElement("template");
  root.replaceChildren();
  const kept: typeof segments.blocks = [];
  for (const block of segments.blocks) {
    template.innerHTML = tools.renderBlock(block.token, tokens.links);
    const nodes = [...template.content.childNodes].filter(
      (node) => node.nodeType === Node.ELEMENT_NODE || node.textContent?.trim(),
    );
    if (nodes.length === 0) {
      // Nothing to show (an empty block): keep its text with the block before it.
      const previous = kept.at(-1);
      if (previous) previous.trailer += block.raw + block.trailer;
      else segments.prefix += block.raw + block.trailer;
      continue;
    }
    let element: HTMLElement;
    if (nodes.length === 1 && nodes[0] instanceof HTMLElement) {
      element = nodes[0];
    } else {
      element = document.createElement(nodes.every((node) => node.nodeType === 3) ? "p" : "div");
      element.append(...nodes);
    }
    element.dataset.b = String(kept.length);
    root.append(element);
    kept.push(block);
  }
  segments.blocks = kept;
  for (const figure of root.querySelectorAll<HTMLElement>(".figure-ref")) {
    figure.contentEditable = "false";
  }
  return {
    segments: exact ? segments : null,
    baseline: [...root.children].map((child) => child.outerHTML),
  };
}

/** Reads the page back as Markdown, keeping the original text of every untouched block. */
function readPage(root: HTMLElement, rendered: Rendered, convert: Loaded["convert"]): string {
  const items: PageItem[] = [];
  const used = new Set<number>();
  const toMarkdown = (element: HTMLElement) => {
    const wrapper = document.createElement("div");
    const clone = element.cloneNode(true) as HTMLElement;
    clone.removeAttribute("data-b");
    wrapper.append(clone);
    return convert(wrapper);
  };
  for (const node of root.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (text) items.push({ markdown: escapeMarkdownText(text) });
      continue;
    }
    if (!(node instanceof HTMLElement)) continue;
    const index = node.dataset.b === undefined ? Number.NaN : Number(node.dataset.b);
    if (
      rendered.segments &&
      !Number.isNaN(index) &&
      !used.has(index) &&
      node.outerHTML === rendered.baseline[index]
    ) {
      used.add(index);
      items.push({ keep: index });
    } else {
      const from = Number.isNaN(index) || used.has(index) ? undefined : index;
      if (from !== undefined) used.add(from);
      items.push({ markdown: toMarkdown(node), from });
    }
  }
  if (!rendered.segments) {
    return items.map((item) => ("markdown" in item ? item.markdown : "")).join("\n\n") + "\n";
  }
  return assembleMarkdown(rendered.segments, items);
}

interface PageEditorProps {
  markdown: string;
  label: string;
  onChange: (markdown: string) => void;
  /** Attributes that give the page its paper, typeface, and size. */
  pageProps: Record<string, string>;
}

/** The document as a page you can edit directly. Changes are saved back as Markdown. */
export function PageEditor({ markdown, label, onChange, pageProps }: PageEditorProps) {
  const root = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const rendered = useRef<Rendered | null>(null);
  const emitted = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const [active, setActive] = useState<Record<string, boolean>>({});
  const [block, setBlock] = useState("p");
  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    let current = true;
    const conventions = detectConventions(markdown);
    Promise.all([loadMarkdown(), loadConverter(conventions)]).then(([tools, convert]) => {
      if (current) setLoaded({ tools, convert });
    });
    return () => {
      current = false;
    };
    // The conventions come from the document as it was opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    if (!loaded || !root.current) return;
    if (emitted.current === markdown) return;
    rendered.current = renderInto(root.current, markdown, loaded.tools);
    emitted.current = markdown;
  }, [markdown, loaded]);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    if (!loaded || !root.current || !rendered.current) return;
    const next = readPage(root.current, rendered.current, loaded.convert);
    if (next !== emitted.current) {
      emitted.current = next;
      onChangeRef.current(next);
    }
  }, [loaded]);

  // Save any edit still waiting when the page closes (the ref below is never cleared).
  useLayoutEffect(() => () => flush(), [flush]);

  const schedule = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 250);
  };

  const readSelection = useCallback(() => {
    const element = root.current;
    const selection = document.getSelection();
    if (!element || !selection?.anchorNode || !element.contains(selection.anchorNode)) return;
    const format = document.queryCommandValue("formatBlock").toLowerCase();
    setActive(
      Object.fromEntries([
        ...INLINE.map(({ command }) => [command, document.queryCommandState(command)]),
        ...BLOCKS.map(({ command, value }) => [
          value ?? command,
          value ? format === value : document.queryCommandState(command),
        ]),
      ]),
    );
    setBlock(BLOCK_FORMATS.some((option) => option.value === format) ? format : "p");
  }, []);

  useEffect(() => {
    document.addEventListener("selectionchange", readSelection);
    return () => document.removeEventListener("selectionchange", readSelection);
  }, [readSelection]);

  const run = (command: string, value?: string) => {
    root.current?.focus();
    if (command === "formatBlock") {
      document.execCommand("formatBlock", false, value && active[value] ? "<p>" : `<${value}>`);
    } else {
      document.execCommand(command, false, value);
    }
    readSelection();
    schedule();
  };

  return (
    <div className="page-editor-wrap">
      <div className="format-bar" role="toolbar" aria-label="Formatting">
        <label className="visually-hidden" htmlFor="block-format">
          Text style
        </label>
        <select
          id="block-format"
          className="format-select"
          value={block}
          onMouseDown={() => readSelection()}
          onChange={(event) => run("formatBlock", event.target.value)}
        >
          {BLOCK_FORMATS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {INLINE.map(({ command, label: name, shortcut, icon: Icon }) => (
          <button
            key={command}
            type="button"
            className="format-button"
            aria-label={name}
            aria-pressed={Boolean(active[command])}
            title={`${name} (${shortcut})`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => run(command)}
          >
            <Icon aria-hidden weight="bold" />
          </button>
        ))}
        <span className="format-gap" aria-hidden />
        {BLOCKS.map(({ command, value, label: name, icon: Icon }) => (
          <button
            key={value ?? command}
            type="button"
            className="format-button"
            aria-label={name}
            aria-pressed={Boolean(active[value ?? command])}
            title={name}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => run(command, value)}
          >
            <Icon aria-hidden />
          </button>
        ))}
      </div>
      <div className="paper page" {...pageProps}>
        <div
          ref={(node) => {
            if (node) root.current = node;
          }}
          className="prose page-editor"
          contentEditable={loaded ? "true" : "false"}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={label}
          aria-busy={!loaded}
          spellCheck
          onFocus={() => document.execCommand("defaultParagraphSeparator", false, "p")}
          onInput={schedule}
          onBlur={flush}
          onPaste={(event) => {
            if (!loaded) return;
            event.preventDefault();
            const html = event.clipboardData.getData("text/html");
            if (html) document.execCommand("insertHTML", false, loaded.tools.cleanPaste(html));
            else
              document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
          }}
          onDrop={(event) => {
            // Dropped files are added to the workspace, not pasted into the page.
            if (event.dataTransfer.types.includes("Files")) event.preventDefault();
          }}
        />
      </div>
    </div>
  );
}
