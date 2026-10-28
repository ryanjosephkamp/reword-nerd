// Turndown rules shared by everything that turns HTML back into Markdown: Word documents on
// the way in, and edits made on the page.
import type TurndownService from "turndown";

/** Every table becomes a Markdown table, with its first row as the header. Word tables have no
 * header row, which the GFM plugin needs, so it would otherwise keep them as raw HTML. */
export function addTableRule(service: TurndownService): void {
  service.addRule("tables", {
    filter: "table",
    replacement: (_content, node) => {
      const rows = [...(node as HTMLTableElement).rows].map((row) =>
        [...row.cells].map((cell) =>
          service
            .turndown(cell.innerHTML)
            .replace(/\s*\n+\s*/g, " ")
            .replaceAll("|", "\\|")
            .trim(),
        ),
      );
      if (rows.length === 0) return "";
      const width = Math.max(...rows.map((row) => row.length));
      const line = (cells: string[]) =>
        `| ${[...cells, ...Array(width - cells.length).fill("")].join(" | ")} |`;
      const divider = line(Array(width).fill("---"));
      return `\n\n${[line(rows[0]), divider, ...rows.slice(1).map(line)].join("\n")}\n\n`;
    },
  });
}

export function addStrikethroughRule(service: TurndownService): void {
  service.addRule("strikethrough", {
    filter: (node) => ["DEL", "S", "STRIKE"].includes(node.nodeName),
    replacement: (content) => `~~${content}~~`,
  });
}
