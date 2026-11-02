import { ArrowsOutLineVertical } from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  lineDiff,
  visibleRows,
  type DiffRow,
  type DiffSegment,
  type LineDiff as Diff,
} from "../engine/results/lineDiff";
import { Segmented } from "./Segmented";

type Layout = "unified" | "split";

function Text({ segments, kind }: { segments: DiffSegment[]; kind: DiffRow["kind"] }) {
  return (
    <>
      {kind !== "same" && (
        <span className="visually-hidden">{kind === "add" ? "Added: " : "Removed: "}</span>
      )}
      {segments.map((segment, index) =>
        segment.changed ? (
          <span key={index} className="diff-word">
            {segment.text}
          </span>
        ) : (
          segment.text
        ),
      )}
      {segments.every((segment) => segment.text === "") && "​"}
    </>
  );
}

const SIGN = { same: " ", add: "+", del: "−" } as const;

/** Splits rows into what to draw: visible rows, and runs of hidden unchanged lines. */
function useSections(rows: readonly DiffRow[], expanded: Set<number>) {
  return useMemo(() => {
    const show = visibleRows(rows);
    const sections: ({ row: DiffRow; index: number } | { gap: number; count: number })[] = [];
    for (let index = 0; index < rows.length;) {
      if (show[index] || expanded.has(index)) {
        sections.push({ row: rows[index], index });
        index += 1;
        continue;
      }
      const start = index;
      while (index < rows.length && !show[index] && !expanded.has(index)) index += 1;
      sections.push({ gap: start, count: index - start });
    }
    return sections;
  }, [rows, expanded]);
}

function GapRow({
  count,
  columns,
  onShow,
}: {
  count: number;
  columns: number;
  onShow: () => void;
}) {
  return (
    <tr className="diff-gap">
      <td colSpan={columns}>
        <button type="button" className="diff-gap-button" onClick={onShow}>
          <ArrowsOutLineVertical aria-hidden />
          Show {count.toLocaleString("en-US")} unchanged {count === 1 ? "line" : "lines"}
        </button>
      </td>
    </tr>
  );
}

/** Pairs removed and added lines side by side, the way a split code review does. */
function splitRows(rows: { row: DiffRow; index: number }[]) {
  const out: { left: DiffRow | null; right: DiffRow | null; key: number }[] = [];
  for (let at = 0; at < rows.length;) {
    const { row, index } = rows[at];
    if (row.kind === "same") {
      out.push({ left: row, right: row, key: index });
      at += 1;
      continue;
    }
    const removed: DiffRow[] = [];
    const added: DiffRow[] = [];
    while (at < rows.length && rows[at].row.kind === "del") removed.push(rows[at++].row);
    while (at < rows.length && rows[at].row.kind === "add") added.push(rows[at++].row);
    for (let line = 0; line < Math.max(removed.length, added.length); line += 1) {
      out.push({ left: removed[line] ?? null, right: added[line] ?? null, key: index + line });
    }
  }
  return out;
}

interface LineDiffProps {
  before: string;
  after: string;
  beforeLabel: string;
  afterLabel: string;
  /** Extra controls shown next to the summary, such as an undo button. */
  actions?: ReactNode;
}

/** Changes between two texts, line by line, with changed words marked: red out, green in. */
export function LineDiff({ before, after, beforeLabel, afterLabel, actions }: LineDiffProps) {
  const [diff, setDiff] = useState<{ key: string; value: Diff } | null>(null);
  const [layout, setLayout] = useState<Layout>("unified");
  const [expanded, setExpanded] = useState<{ key: string; rows: Set<number> }>({
    key: "",
    rows: new Set(),
  });
  const key = `${before.length}:${after.length}:${before.slice(0, 64)}:${after.slice(-64)}`;

  useEffect(() => {
    let current = true;
    lineDiff(before, after).then((value) => {
      if (current) setDiff({ key: `${before}\u0000${after}`, value });
    });
    return () => {
      current = false;
    };
  }, [before, after]);

  const ready = diff?.key === `${before}\u0000${after}` ? diff.value : null;
  const open = expanded.key === key ? expanded.rows : new Set<number>();
  const sections = useSections(ready?.rows ?? [], open);
  const show = (start: number, count: number) => {
    const next = new Set(open);
    for (let index = start; index < start + count; index += 1) next.add(index);
    setExpanded({ key, rows: next });
  };

  if (!ready) return <p className="loading">Comparing…</p>;

  const summary = (
    <div className="diff-bar">
      <p className="diff-stat">
        <span className="diff-stat-add">+{ready.added.toLocaleString("en-US")}</span>{" "}
        <span className="diff-stat-del">−{ready.removed.toLocaleString("en-US")}</span>{" "}
        <span className="muted">
          {ready.added + ready.removed === 1 ? "line" : "lines"} changed
        </span>
      </p>
      <div className="diff-tools">
        {actions}
        <Segmented
          label="Layout"
          hideLabel
          value={layout}
          options={[
            { value: "unified", label: "Unified" },
            { value: "split", label: "Split" },
          ]}
          onChange={setLayout}
        />
      </div>
    </div>
  );

  if (ready.added + ready.removed === 0) {
    return (
      <div className="line-diff">
        {summary}
        <p className="muted pane-pad">No changes from the {beforeLabel.toLowerCase()}.</p>
      </div>
    );
  }

  const caption = `Changes from the ${beforeLabel.toLowerCase()} to the ${afterLabel.toLowerCase()}`;

  if (layout === "split") {
    return (
      <div className="line-diff">
        {summary}
        <div className="diff-scroll">
          <table className="diff-table diff-split">
            <caption className="visually-hidden">{caption}</caption>
            <colgroup>
              <col className="diff-col-num" />
              <col />
              <col className="diff-col-num" />
              <col />
            </colgroup>
            <tbody>
              {splitSections(sections).map((item) =>
                "gap" in item ? (
                  <GapRow
                    key={`gap-${item.gap}`}
                    count={item.count}
                    columns={4}
                    onShow={() => show(item.gap, item.count)}
                  />
                ) : (
                  <tr key={item.key} className="diff-row">
                    <SplitSide row={item.left} which="old" />
                    <SplitSide row={item.right} which="new" />
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="line-diff">
      {summary}
      <div className="diff-scroll">
        <table className="diff-table diff-unified">
          <caption className="visually-hidden">{caption}</caption>
          <colgroup>
            <col className="diff-col-num" />
            <col className="diff-col-num" />
            <col className="diff-col-sign" />
            <col />
          </colgroup>
          <tbody>
            {sections.map((section) =>
              "gap" in section ? (
                <GapRow
                  key={`gap-${section.gap}`}
                  count={section.count}
                  columns={4}
                  onShow={() => show(section.gap, section.count)}
                />
              ) : (
                <tr key={section.index} className={`diff-row diff-${section.row.kind}`}>
                  <td className="diff-num">{section.row.oldLine ?? ""}</td>
                  <td className="diff-num">{section.row.newLine ?? ""}</td>
                  <td className="diff-sign" aria-hidden>
                    {SIGN[section.row.kind]}
                  </td>
                  <td className="diff-text">
                    <Text segments={section.row.segments} kind={section.row.kind} />
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SplitSide({ row, which }: { row: DiffRow | null; which: "old" | "new" }) {
  if (!row) {
    return (
      <>
        <td className="diff-num diff-empty" />
        <td className="diff-text diff-empty" />
      </>
    );
  }
  return (
    <>
      <td className={`diff-num diff-${row.kind}`}>{which === "old" ? row.oldLine : row.newLine}</td>
      <td className={`diff-text diff-${row.kind}`}>
        <Text segments={row.segments} kind={row.kind} />
      </td>
    </>
  );
}

/** The split layout's rows: hidden runs stay as gaps, and each run of shown rows is paired up. */
function splitSections(sections: ReturnType<typeof useSections>) {
  const out: (ReturnType<typeof splitRows>[number] | { gap: number; count: number })[] = [];
  let run: { row: DiffRow; index: number }[] = [];
  for (const section of sections) {
    if ("gap" in section) {
      out.push(...splitRows(run), section);
      run = [];
    } else {
      run.push(section);
    }
  }
  out.push(...splitRows(run));
  return out;
}
