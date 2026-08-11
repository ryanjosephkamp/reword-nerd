export function StatusSummary({ total, ready, review, blocked, compact = false }: {
  total: number;
  ready: number;
  review: number;
  blocked: number;
  compact?: boolean;
}) {
  return <div className={`status-summary${compact ? " compact" : ""}`}>
    <span className="status-item">{total} files</span>
    <span className="status-item ready-text">{ready} ready</span>
    <span className="status-item review-text">{review} review</span>
    {blocked > 0 ? <span className="status-item blocked-text">{blocked} blocked</span> : null}
  </div>;
}
