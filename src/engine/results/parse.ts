// Reads what a model sends back, whether it followed the output format exactly or not.

export interface ParsedFile {
  path: string;
  text: string;
}

export interface ParsedReply {
  /** The rewritten document, for a single-document job. */
  document: string | null;
  /** Rewritten files, for a multi-file job. */
  files: ParsedFile[];
  /** The model's own fidelity check, if it included one. */
  audit: string | null;
  /** True when the reply had none of the expected markers and was taken as-is. */
  unstructured: boolean;
}

function between(text: string, start: string, end: string): string | null {
  const from = text.indexOf(start);
  if (from < 0) return null;
  const contentStart = from + start.length;
  const to = text.indexOf(end, contentStart);
  return trimBlock(text.slice(contentStart, to < 0 ? undefined : to));
}

/** Drops the line break right after an opening marker and right before a closing one. */
function trimBlock(block: string): string {
  return block.replace(/^\r?\n/, "").replace(/\r?\n[ \t]*$/, "");
}

/** Chat apps often wrap the whole reply in a code fence; remove one outer fence if present. */
function unfence(reply: string): string {
  const trimmed = reply.trim();
  const match = /^```[\w-]*\r?\n([\s\S]*?)\r?\n```$/.exec(trimmed);
  return match ? match[1] : trimmed;
}

export function parseReply(reply: string): ParsedReply {
  const text = unfence(reply);
  const audit = between(text, "<<<FIDELITY_AUDIT>>>", "<<<END_FIDELITY_AUDIT>>>");
  const document = between(text, "<<<FINAL_DOCUMENT>>>", "<<<END_FINAL_DOCUMENT>>>");

  const files: ParsedFile[] = [];
  const filePattern = /<<<FILE ([^\n>]+)>>>\r?\n([\s\S]*?)\r?\n?<<<END_FILE>>>/g;
  for (const match of text.matchAll(filePattern)) {
    files.push({ path: match[1].trim(), text: match[2] });
  }

  if (document === null && files.length === 0) {
    const withoutAudit =
      audit === null ? text : text.slice(0, text.indexOf("<<<FIDELITY_AUDIT>>>"));
    return { document: withoutAudit.trim(), files: [], audit, unstructured: true };
  }
  return { document, files, audit, unstructured: false };
}

export type AuditVerdict = "pass" | "review" | "unknown";

/** Summarizes the audit as one verdict: any REVIEW line means the person should look closer. */
export function auditVerdict(audit: string | null): AuditVerdict {
  if (!audit) return "unknown";
  if (/\bREVIEW\b/.test(audit)) return "review";
  if (/\bPASS\b/.test(audit)) return "pass";
  return "unknown";
}
