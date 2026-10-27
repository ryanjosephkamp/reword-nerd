/** JSON data with explicit duplicate-key rejection; no string normalization. */
export function parseStrictJson(text: string): unknown {
  let pos = 0;
  const space = () => { while (/\s/u.test(text[pos] ?? "") && pos < text.length) { if (!" \t\r\n".includes(text[pos])) throw Error("Invalid JSON whitespace"); pos++; } };
  function string(): string {
    const start = pos++;
    while (pos < text.length) {
      const c = text[pos++];
      if (c === "\\") { pos++; continue; }
      if (c === '"') return JSON.parse(text.slice(start, pos)) as string;
    }
    throw Error("Unterminated JSON string");
  }
  function value(depth: number): unknown {
    if (depth > 64) throw Error("JSON nesting limit");
    space(); const c = text[pos];
    if (c === '"') return string();
    if (c === "{" || c === "[") {
      const object = c === "{", end = object ? "}" : "]";
      const result: Record<string, unknown> = Object.create(null), array: unknown[] = [], seen = new Set<string>();
      pos++; space(); if (text[pos] === end) { pos++; return object ? result : array; }
      while (pos < text.length) {
        space();
        if (object) {
          if (text[pos] !== '"') throw Error("Expected JSON key");
          const key = string(); if (seen.has(key)) throw Error("Duplicate JSON key: " + key); seen.add(key);
          space(); if (text[pos++] !== ":") throw Error("Expected JSON colon");
          result[key] = value(depth + 1);
        } else array.push(value(depth + 1));
        space(); const delimiter = text[pos++];
        if (delimiter === end) return object ? result : array;
        if (delimiter !== ",") throw Error("Invalid JSON separator");
      }
      throw Error("Incomplete JSON structure");
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u.exec(text.slice(pos));
    if (!match) throw Error("Invalid JSON value");
    pos += match[0].length; const result: unknown = JSON.parse(match[0]);
    if (typeof result === "number" && !Number.isFinite(result)) throw Error("Nonfinite JSON number");
    return result;
  }
  const result = value(0); space(); if (pos !== text.length) throw Error("Extra JSON content"); return result;
}
