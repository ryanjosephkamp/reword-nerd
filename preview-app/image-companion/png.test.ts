import { crc32 as nativeCrc32, deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { PNG_LIMITS, PngValidationError } from "./png";
import {createPngInspector} from "./portable/png";
import {browserRuntime} from "./portable/browser";
import {nodeRuntime} from "./nodeRuntime";

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function chunk(type: string, payload: Buffer = Buffer.alloc(0)): Buffer {
  const out = Buffer.alloc(payload.length + 12);
  out.writeUInt32BE(payload.length, 0); out.write(type, 4); payload.copy(out, 8);
  out.writeUInt32BE(nativeCrc32(out.subarray(4, -4)), out.length - 4);
  return out;
}
function png(options: { width?: number; height?: number; color?: number; depth?: number; interlace?: number; raster?: Buffer; extra?: Buffer[]; compressedSuffix?: Buffer } = {}): Buffer {
  const width = options.width ?? 2, height = options.height ?? 2, color = options.color ?? 6;
  const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[color] ?? 4;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  header[8] = options.depth ?? 8; header[9] = color; header[12] = options.interlace ?? 0;
  const raster = options.raster ?? Buffer.alloc((width * channels + 1) * height);
  return Buffer.concat([signature, chunk("IHDR", header), ...(options.extra ?? []), chunk("IDAT", Buffer.concat([deflateSync(raster), options.compressedSuffix ?? Buffer.alloc(0)])), chunk("IEND")]);
}

describe.each([["Node",nodeRuntime],["browser",browserRuntime]] as const)("%s PNG adapter",(_name,runtime)=>{
const inspectPng=createPngInspector(runtime);
describe("bounded PNG raster validation", () => {
  it.each([0, 2, 4, 6])("accepts genuine 8-bit static color mode %i with exact dimensions", color => {
    expect(inspectPng(png({ color }))).toEqual({ width: 2, height: 2, mimeType: "image/png" });
  });
  it("accepts all five legal row filters and bounded uncompressed text metadata", () => {
    const raster = Buffer.alloc(5 * 9);
    for (let row = 0; row < 5; row++) raster[row * 9] = row;
    expect(inspectPng(png({ height: 5, raster, extra: [chunk("tEXt", Buffer.from("Comment\0Synthetic no-model test"))] })).height).toBe(5);
  });
  it.each([
    ["indexed color", { color: 3 }], ["16-bit color", { depth: 16 }], ["interlace", { interlace: 1 }],
  ] as const)("rejects unsupported %s explicitly", (_, options) => {
    expect(() => inspectPng(png(options))).toThrow(/unsupported/u);
  });
  it("rejects signatures, truncation, chunk CRC errors and trailing bytes", () => {
    const bytes = png(), bad = Buffer.from(bytes); bad[44] ^= 1;
    for (const candidate of [Buffer.from("<svg onload='alert(1)'/>"), bytes.subarray(0, -3), bad, Buffer.concat([bytes, Buffer.from("hidden")])]) expect(() => inspectPng(candidate)).toThrow(PngValidationError);
  });
  it("rejects dimensions and actual file size over the declared limits", () => {
    expect(() => inspectPng(png({ width: 4097, height: 1 }))).toThrow(/dimensions/u);
    expect(() => inspectPng(Buffer.alloc(PNG_LIMITS.bytes + 1))).toThrow(/limit/u);
    expect(() => inspectPng(png(), 20)).toThrow(PngValidationError);
  });
  it("bounds actual inflation against dimensions and rejects short rasters or invalid row filters", () => {
    for (const raster of [Buffer.alloc(1_000_000), Buffer.alloc(2), Buffer.from([5, 0, 0, 0, 0])]) expect(() => inspectPng(png({ width: 1, height: 1, raster }))).toThrow(PngValidationError);
  });
  it("rejects trailing compressed data and concatenated zlib streams", () => {
    for (const compressedSuffix of [Buffer.from("hidden"), deflateSync(Buffer.from("second stream"))]) expect(() => inspectPng(png({ compressedSuffix }))).toThrow(/trailing|concatenated/u);
  });
  it.each(["acTL", "fcTL", "fdAT", "zTXt", "iCCP", "iTXt", "eXIf", "vpAg"])("rejects unsupported %s chunks before image rendering", type => {
    expect(() => inspectPng(png({ extra: [chunk(type, Buffer.from("payload"))] }))).toThrow(/unsupported|not accepted/u);
  });
  it("rejects duplicate dimension headers, non-consecutive IDAT and malformed ancillary chunks", () => {
    const bytes = png();
    const ihdr = bytes.subarray(8, 33), data = bytes.subarray(33, -12), iend = bytes.subarray(-12);
    expect(() => inspectPng(Buffer.concat([signature, ihdr, ihdr, data, iend]))).toThrow(PngValidationError);
    expect(() => inspectPng(Buffer.concat([signature, ihdr, data, chunk("tEXt", Buffer.from("Name\0Text")), data, iend]))).toThrow(/consecutive/u);
    expect(() => inspectPng(png({ extra: [chunk("gAMA", Buffer.alloc(1))] }))).toThrow(PngValidationError);
  });
});

/** Only the outer envelope is interpreted; inner bytes must remain opaque. */
function cabx(payload: Buffer = Buffer.from('opaque metadata')): Buffer {
  const box = Buffer.alloc(8 + payload.length);
  box.writeUInt32BE(box.length); box.write('jumb', 4); payload.copy(box, 8);
  return box;
}
describe('bounded opaque caBX metadata', () => {
  it('accepts one outer JUMBF box without altering or interpreting its bytes', () => {
    const bytes = png({ extra: [chunk('caBX', cabx(Buffer.from('<script>globalThis.compromised=true</script>')))] });
    const original = Buffer.from(bytes);
    expect(inspectPng(bytes)).toEqual({width:2,height:2,mimeType:'image/png'});
    expect(bytes).toEqual(original);
    expect('compromised' in globalThis).toBe(false);
  });
  it('accepts the exact aggregate metadata boundary and rejects one extra byte', () => {
    const atLimit = cabx(Buffer.alloc(PNG_LIMITS.metadataBytes - 8));
    expect(()=>inspectPng(png({extra:[chunk('caBX',atLimit)]}))).not.toThrow();
    expect(()=>inspectPng(png({extra:[chunk('caBX',cabx(Buffer.alloc(PNG_LIMITS.metadataBytes - 7)))]}))).toThrow(/metadata exceeds/);
    expect(()=>inspectPng(png({extra:[chunk('caBX',atLimit),chunk('tEXt',Buffer.from('x\0y'))]}))).toThrow(/metadata exceeds/);
  });
  it('rejects empty, wrong-type, extended, to-end, short and overlong outer envelopes', () => {
    const good = cabx();
    const bad = [Buffer.alloc(0),Buffer.alloc(8),Buffer.from(good),Buffer.from(good),Buffer.from(good),Buffer.from(good),Buffer.from(good)];
    bad[2].write('json',4);bad[3].writeUInt32BE(1);bad[4].writeUInt32BE(0);bad[5].writeUInt32BE(good.length-1);bad[6].writeUInt32BE(good.length+1);
    for(const value of bad)expect(()=>inspectPng(png({extra:[chunk('caBX',value)]}))).toThrow(/caBX/);
    expect(()=>inspectPng(png({extra:[chunk('caBX',Buffer.concat([good,good]))]}))).toThrow(/caBX/);
  });
  it('rejects duplicate and post-IDAT metadata, including interleaving with image data', () => {
    const extra=chunk('caBX',cabx()), bytes=png();
    expect(()=>inspectPng(png({extra:[extra,extra]}))).toThrow(/uniqueness/);
    expect(()=>inspectPng(Buffer.concat([bytes.subarray(0,-12),extra,bytes.subarray(-12)]))).toThrow(/ordering/);
    expect(()=>inspectPng(Buffer.concat([bytes.subarray(0,-12),extra,bytes.subarray(33)]))).toThrow(/ordering/);
  });
  it('rejects corrupted caBX CRC and truncated declared chunk bounds', () => {
    const extra=chunk('caBX',cabx());extra[extra.length-1]^=1;
    expect(()=>inspectPng(png({extra:[extra]}))).toThrow(/CRC/);
    const bytes=png({extra:[chunk('caBX',cabx())]});bytes.writeUInt32BE(0x7fffffff,33);
    expect(()=>inspectPng(bytes)).toThrow(/bounds|beyond/);
  });
  it('does not relax decoded raster validation when caBX is present', () => {
    expect(()=>inspectPng(png({width:1,height:1,raster:Buffer.alloc(1_000_000),extra:[chunk('caBX',cabx())]}))).toThrow(/data|dimensions/);
    expect(()=>inspectPng(png({width:4097,height:1,extra:[chunk('caBX',cabx())]}))).toThrow(/dimensions/);
  });
});

});
