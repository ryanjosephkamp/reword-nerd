import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { copyText } from "../copyText";

const markdownElements = [
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote",
  "pre", "code", "em", "strong", "del", "table", "thead", "tbody", "tr", "th", "td", "hr", "br", "a", "img",
];

function inertUrl(url: string, label: React.ReactNode) {
  return <span className="inert-url">
    <span>{label}</span>
    <span className="url-text">{url}</span>
    <button type="button" onClick={() => void copyText(url)}>Copy URL</button>
  </span>;
}

export default function MarkdownOriginalPreview({ text }: { text: string }) {
  return <article className="safe-rich-preview" aria-label="Markdown original preview">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      allowedElements={markdownElements}
      unwrapDisallowed
      components={{
        a: ({ href = "", children }) => inertUrl(href, children),
        img: ({ src = "", alt = "" }) => inertUrl(src, alt || "Image resource"),
      }}
    >{text}</ReactMarkdown>
  </article>;
}
