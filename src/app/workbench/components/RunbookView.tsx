import type { RunbookInline, RunbookDocument } from "../../../export";

function InlineContent({ values }: { values: readonly RunbookInline[] }) {
  return <>{values.map((value, index) => {
    const key = `${value.type}-${index}`;
    if (value.type === "code") return <code key={key}>{value.value}</code>;
    if (value.type === "link") return <a key={key} href={value.href}>{value.label}</a>;
    return <span key={key}>{value.value}</span>;
  })}</>;
}

export function RunbookView({ document }: { document: Readonly<RunbookDocument> }) {
  return <div className="rich-runbook">
    {document.blocks.map((block, index) => {
      const key = `${block.type}-${index}`;
      if (block.type === "heading") {
        return block.depth === 1
          ? <h4 key={key}><InlineContent values={block.content} /></h4>
          : <h5 key={key}><InlineContent values={block.content} /></h5>;
      }
      if (block.type === "paragraph") {
        return <p key={key}><InlineContent values={block.content} /></p>;
      }
      if (block.type === "list") {
        const items = block.items.map((item, itemIndex) => <li key={itemIndex}><InlineContent values={item} /></li>);
        return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
      }
      if (block.type === "code-block") {
        return <pre key={key}><code data-language={block.language}>{block.value}</code></pre>;
      }
      return <div className="rich-runbook-table" key={key}>
        <table>
          <thead><tr>{block.headers.map((header) => <th scope="col" key={header}>{header}</th>)}</tr></thead>
          <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>
            {row.map((cell, cellIndex) => <td key={cellIndex}><InlineContent values={[cell]} /></td>)}
          </tr>)}</tbody>
        </table>
      </div>;
    })}
  </div>;
}
