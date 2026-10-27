// @vitest-environment jsdom
import { afterAll, describe, expect, it, vi } from "vitest";
import { Buffer } from "node:buffer";
// The renderer validates Node Buffers; use their Uint8Array realm in this DOM harness.
vi.stubGlobal(
  "Uint8Array",
  Object.getPrototypeOf(Buffer.prototype).constructor,
);
afterAll(() => vi.unstubAllGlobals());
import { deflateSync } from "node:zlib";
import { renderImageReview, type ImageReviewModel } from "./review";

function crc(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let i = 0; i < 8; i++)
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type: string, bytes: Buffer): Buffer {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc(Buffer.concat([name, bytes])));
  return Buffer.concat([length, name, bytes, checksum]);
}
function png(red = 50): string {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.from([0, red, 100, 150, 255]))),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}
function model(): ImageReviewModel {
  return {
    jobId: "job-001",
    packageSha256: "package-hash",
    pairKey: "pair-001",
    displayName: "Garden reference.png",
    prompt: "Keep the lettering.\nPreserve the original composition.",
    promptSha256: "prompt-hash",
    referenceSha256: "reference-hash",
    referenceBase64: png(),
    width: 1,
    height: 1,
    execution: { mode: "fixture", host: "Test host", model: "Synthetic PNG" },
    attempts: [
      {
        attempt: 1,
        revision: 1,
        ticketId: "ticket-1",
        status: "recorded",
        resultSha256: "result-hash",
        resultBase64: png(200),
        width: 1,
        height: 1,
      },
    ],
    currentTicketId: "ticket-1",
  };
}
function parseReview(input = model()): Document {
  return new DOMParser().parseFromString(renderImageReview(input), "text/html");
}

function interactiveReview(input: ImageReviewModel): Document {
  const parsed = parseReview(input);
  globalThis.document.documentElement.innerHTML =
    parsed.documentElement.innerHTML;
  // Execute only this renderer's trusted, static script in the test DOM.
  window.eval(globalThis.document.querySelector("script")!.textContent!);
  return globalThis.document;
}

describe("image companion standalone review", () => {
  it("embeds exact PNG bytes and exposes reported hashes without claiming acceptance", () => {
    const input = model(),
      doc = parseReview(input);
    const reference = doc.querySelector<HTMLImageElement>(
      'img[alt^="Original reference"]',
    )!;
    const result = doc.querySelector<HTMLImageElement>(
      'img[alt^="Recorded result"]',
    )!;
    expect(reference.getAttribute("src")).toBe(
      `data:image/png;base64,${input.referenceBase64}`,
    );
    expect(result.getAttribute("src")).toBe(
      `data:image/png;base64,${input.attempts[0].resultBase64}`,
    );
    expect(
      doc.querySelector('a[download="reference.png"]')?.getAttribute("href"),
    ).toBe(reference.getAttribute("src"));
    expect(
      doc.querySelector('a[download="result-r1-a1.png"]')?.getAttribute("href"),
    ).toBe(result.getAttribute("src"));
    expect(doc.body.textContent).toContain("Fixture demonstration");
    expect(doc.body.textContent).toContain(
      "not evidence of a live image generation run",
    );
    expect(doc.body.textContent).toContain("User review required");
    expect(doc.querySelector("#prompt pre")?.textContent).toBe(input.prompt);
    expect(
      doc
        .querySelector('button[data-layout="side"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("escapes all imported text, including attribute and script-breakout strings", () => {
    const attack =
      '"\'><img id="injected" src="https://bad.invalid/x" onerror="window.pwned=1"><script>window.pwned=2</script>&';
    const input = model();
    for (const key of [
      "jobId",
      "packageSha256",
      "pairKey",
      "displayName",
      "prompt",
      "promptSha256",
      "referenceSha256",
    ] as const)
      input[key] = attack;
    input.execution = { mode: attack, host: attack, model: attack };
    input.attempts[0] = {
      ...input.attempts[0],
      ticketId: attack,
      status: attack,
      resultSha256: attack,
      executor: attack,
      model: attack,
      reason: attack,
    };
    input.currentTicketId = attack;
    const doc = interactiveReview(input);
    expect(doc.querySelector("#injected")).toBeNull();
    expect(doc.querySelectorAll("script")).toHaveLength(1);
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
    expect(doc.querySelector("#prompt pre")?.textContent).toBe(attack);
    expect(doc.querySelector("#job-id")?.textContent).toBe(attack);
    expect(
      doc.querySelectorAll("[onclick],[onerror],[onload],iframe,object,embed"),
    ).toHaveLength(0);
    expect(
      [...doc.querySelectorAll("img")].every((img) =>
        img.src.startsWith("data:image/png;base64,"),
      ),
    ).toBe(true);
  });

  it.each([
    [
      "HTML payload",
      Buffer.from('<svg onload="alert(1)"></svg>').toString("base64"),
    ],
    ["data URI supplied as base64", `data:image/png;base64,${png()}`],
    ["base64 with whitespace", `${png()}\n`],
    [
      "truncated PNG",
      Buffer.from(png(), "base64").subarray(0, 45).toString("base64"),
    ],
    [
      "trailing bytes",
      Buffer.concat([
        Buffer.from(png(), "base64"),
        Buffer.from("extra"),
      ]).toString("base64"),
    ],
    [
      "CRC corruption",
      (() => {
        const b = Buffer.from(png(), "base64");
        b[29] ^= 1;
        return b.toString("base64");
      })(),
    ],
  ])("fails closed for %s in source and result", (_label, data) => {
    const input = model();
    input.referenceBase64 = data;
    input.attempts[0].resultBase64 = data;
    const doc = parseReview(input);
    expect(doc.querySelectorAll("img")).toHaveLength(0);
    expect(doc.querySelectorAll('a[download$=".png"]')).toHaveLength(0);
    expect(doc.body.textContent).toContain("Reference image unavailable");
    expect(doc.body.textContent).toContain("Image could not be displayed");
    expect(doc.querySelector("#prompt pre")?.textContent).toBe(input.prompt);
  });

  it("rejects mismatched dimensions and unsafe size metadata", () => {
    const input = model();
    input.width = 2;
    input.attempts[0].height = NaN;
    expect(parseReview(input).querySelectorAll("img")).toHaveLength(0);
    input.width = 80_000_001;
    input.height = 1;
    expect(parseReview(input).querySelectorAll("img")).toHaveLength(0);
  });

  it("does not substitute a prior image for a pending current ticket", () => {
    const input = model();
    input.attempts.push({
      attempt: 2,
      revision: 1,
      ticketId: "ticket-2",
      status: "pending",
    });
    input.currentTicketId = "ticket-2";
    const doc = parseReview(input);
    expect(doc.querySelector<HTMLSelectElement>("#attempt-select")?.value).toBe(
      "1",
    );
    expect(
      doc.querySelector('[data-attempt="0"]')?.hasAttribute("hidden"),
    ).toBe(true);
    expect(
      doc.querySelector('[data-attempt="1"]')?.hasAttribute("hidden"),
    ).toBe(false);
    expect(doc.querySelector('[data-attempt="1"]')?.textContent).toContain(
      "No image recorded",
    );
  });

  it("renders partial progress, missing tickets, and unknown provenance honestly", () => {
    const input = model();
    input.execution = { mode: "unrecognized", host: null, model: "  " };
    input.currentTicketId = "missing-ticket";
    let doc = parseReview(input);
    expect(doc.querySelector<HTMLSelectElement>("#attempt-select")?.value).toBe(
      "-1",
    );
    expect(
      doc.querySelector('[data-attempt="0"]')?.hasAttribute("hidden"),
    ).toBe(true);
    expect(doc.body.textContent).toContain("Execution provenance not verified");
    expect(doc.body.textContent).toContain("Unknown");
    input.attempts = [];
    input.currentTicketId = null;
    doc = parseReview(input);
    expect(doc.querySelector("#attempt-select")).toBeNull();
    expect(doc.body.textContent).toContain("No attempts recorded");
    expect(doc.querySelector('img[alt^="Original reference"]')).not.toBeNull();
  });

  it("switches between historical attempts and comparison layouts without a server", () => {
    const input = model();
    input.attempts.push({
      ...input.attempts[0],
      attempt: 2,
      ticketId: "ticket-2",
    });
    input.currentTicketId = null;
    const doc = interactiveReview(input);
    expect(doc.querySelector("#selection-status")?.textContent).toContain(
      "latest historical attempt",
    );
    const select = doc.querySelector<HTMLSelectElement>("#attempt-select")!;
    select.value = "0";
    select.dispatchEvent(new Event("change"));
    expect(doc.querySelector<HTMLElement>('[data-attempt="0"]')?.hidden).toBe(
      false,
    );
    expect(doc.querySelector<HTMLElement>('[data-attempt="1"]')?.hidden).toBe(
      true,
    );
    doc
      .querySelector<HTMLButtonElement>('button[data-layout="stack"]')!
      .click();
    expect(doc.querySelector("#comparison")?.getAttribute("data-layout")).toBe(
      "stack",
    );
    expect(
      doc
        .querySelector('button[data-layout="stack"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    const notes = doc.querySelector<HTMLTextAreaElement>("#review-notes")!;
    notes.value = "Keep the text. Change the crop.";
    notes.dispatchEvent(new Event("input"));
    expect(doc.querySelector("#notes-status")?.textContent).toContain(
      "Unsaved notes",
    );
  });

  it("restricts remote resources and exposes no generation or acceptance controls", () => {
    const doc = parseReview();
    const csp = doc
      .querySelector('meta[http-equiv="Content-Security-Policy"]')
      ?.getAttribute("content");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("img-src data:");
    expect(
      doc.querySelectorAll("script[src],link[href],iframe,form"),
    ).toHaveLength(0);
    expect(
      [...doc.querySelectorAll("button")].map((button) => button.textContent),
    ).toEqual(["Side by side", "Stacked", "Download notes ↙"]);
    expect(
      [...doc.querySelectorAll("a[href]")].every(
        (link) =>
          link.getAttribute("href")!.startsWith("#") ||
          link.getAttribute("href") === "./saved-configuration.json" ||
          link.getAttribute("href")!.startsWith("data:image/png;base64,"),
      ),
    ).toBe(true);
  });
});
