// Literal insertion only. This exact source is embedded in portable workbooks.
export function hydrateBoundPrompt(prompt, slots, responses) {
  const markers = { decompose: "<<<INSERT_STAGE_1_DECOMPOSITION_RESPONSE>>>", rewrite: "<<<INSERT_STAGE_2_REWRITE_RESPONSE>>>", verify: "<<<INSERT_STAGE_3_VERIFICATION_RESPONSE>>>" };
  let cursor = 0;
  let text = "";
  const seen = new Set();
  for (const slot of slots) {
    const marker = markers[slot.stage];
    if (!marker || seen.has(slot.stage) || !Number.isInteger(slot.start) || !Number.isInteger(slot.end) || slot.start < cursor || slot.end > prompt.length || prompt.slice(slot.start, slot.end) !== marker) throw new Error("Invalid canonical hydration binding.");
    seen.add(slot.stage);
    const value = responses[slot.stage];
    text += prompt.slice(cursor, slot.start) + (value?.trim() ? value : marker);
    cursor = slot.end;
  }
  return text + prompt.slice(cursor);
}
