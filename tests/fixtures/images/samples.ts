// Small, generated sample files for the image intake tests. Images carry just enough of
// their real headers to be recognized; `fakeDecoder` reads PNG sizes from the header
// because jsdom can't decode images.
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import type { ImageDecoder } from "../../../src/engine/images/validate";

const text = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

export interface PngOptions {
  width?: number;
  height?: number;
  /** Changes the bytes (and so the hash) without changing the size. */
  seed?: number;
  /** Makes `fakeDecoder` fail, like a damaged file would. */
  broken?: boolean;
  /** Pads the file to this many bytes. */
  byteLength?: number;
}

export function pngBytes({
  width = 640,
  height = 480,
  seed = 0,
  broken = false,
  byteLength,
}: PngOptions = {}): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(25);
  header.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(header.buffer);
  view.setUint32(8, 13);
  header.set(text.encode("IHDR"), 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  header[24] = 8;
  const body = concat(header, Uint8Array.of(seed & 0xff, (seed >> 8) & 0xff));
  const marked = broken ? concat(body, text.encode("BROKEN")) : body;
  if (byteLength === undefined || byteLength <= marked.byteLength) return marked;
  const padded = new Uint8Array(byteLength);
  padded.set(marked);
  return padded;
}

export function jpegBytes(seed = 0): Uint8Array<ArrayBuffer> {
  return Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 16, seed);
}

export function webpBytes(seed = 0, trailing = 0): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(16 + trailing);
  bytes.set(text.encode("RIFF"));
  new DataView(bytes.buffer).setUint32(4, 8, true);
  bytes.set(text.encode("WEBP"), 8);
  bytes[12] = seed;
  return bytes;
}

export function ftypBytes(major: string, compatible: string[]): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(16 + compatible.length * 4);
  new DataView(bytes.buffer).setUint32(0, bytes.byteLength);
  bytes.set(text.encode("ftyp"), 4);
  bytes.set(text.encode(major), 8);
  compatible.forEach((brand, index) => bytes.set(text.encode(brand), 16 + index * 4));
  return bytes;
}

export const avifBytes = () => ftypBytes("avif", ["mif1", "miaf"]);
export const heicBytes = () => ftypBytes("heic", ["mif1", "heic"]);
export const gifBytes = () => text.encode("GIF89a....");

/** An EMF drawing header, as Word stores some charts and clip art. */
export function emfBytes(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(64);
  bytes[0] = 1;
  bytes.set(text.encode(" EMF"), 40);
  return bytes;
}

/** Reads PNG sizes from the header; other formats get fixed sizes. */
export const fakeDecoder: ImageDecoder = async (image) => {
  const bytes = new Uint8Array(await image.arrayBuffer());
  if (new TextDecoder().decode(bytes.subarray(27, 33)) === "BROKEN") {
    throw new Error("decode failed");
  }
  if (image.type === "image/png") {
    const view = new DataView(bytes.buffer);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  return { width: 800, height: 600 };
};

export function file(name: string, bytes: Uint8Array<ArrayBuffer>, type = ""): File {
  return new File([bytes], name, { type });
}

export async function zipBytes(
  entries: [path: string, bytes: Uint8Array][],
): Promise<Uint8Array<ArrayBuffer>> {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  for (const [path, bytes] of entries) await writer.add(path, new Uint8ArrayReader(bytes));
  return (await writer.close()) as Uint8Array<ArrayBuffer>;
}

export interface DocxOptions {
  /** Files placed in word/media/. */
  media: [name: string, bytes: Uint8Array][];
  /** Media names in the order the document body shows them. */
  bodyOrder?: string[];
  /** Extra parts, such as an embedded spreadsheet. */
  extra?: [path: string, bytes: Uint8Array][];
  withoutContentTypes?: boolean;
}

export function docxBytes({
  media,
  bodyOrder = media.map(([name]) => name),
  extra = [],
  withoutContentTypes = false,
}: DocxOptions): Promise<Uint8Array<ArrayBuffer>> {
  const ids = new Map(media.map(([name], index) => [name, `rId${index + 10}`]));
  const relationships = media
    .map(
      ([name]) =>
        `<Relationship Id="${ids.get(name)}" ` +
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" ' +
        `Target="media/${name}"/>`,
    )
    .join("");
  const blips = bodyOrder
    .map(
      (name) => `<w:p><w:r><w:drawing><a:blip r:embed="${ids.get(name)}"/></w:drawing></w:r></w:p>`,
    )
    .join("");
  const parts: [string, Uint8Array][] = [
    ["_rels/.rels", text.encode("<Relationships/>")],
    [
      "word/document.xml",
      text.encode(
        '<w:document xmlns:w="w" xmlns:r="r" xmlns:a="a"><w:body>' +
          blips +
          "</w:body></w:document>",
      ),
    ],
    [
      "word/_rels/document.xml.rels",
      text.encode(
        "<Relationships>" +
          relationships +
          '<Relationship Id="rId99" Type="hyperlink" Target="https://example.com" ' +
          'TargetMode="External"/></Relationships>',
      ),
    ],
    ...media.map(([name, bytes]): [string, Uint8Array] => [`word/media/${name}`, bytes]),
    ...extra,
  ];
  if (!withoutContentTypes) parts.unshift(["[Content_Types].xml", text.encode("<Types/>")]);
  return zipBytes(parts);
}

/**
 * A three-page PDF built by hand. Page 1 paints an 80 × 60 RGB picture, an 8 × 8 gray
 * picture, a 48 × 48 one-bit picture, and a 40 × 40 inline picture. Pages 2 and 3 repeat the
 * RGB picture, which pdf.js then shares between pages.
 */
export function pdfBytes(): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: string | Uint8Array) => {
    const bytes = typeof chunk === "string" ? text.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.byteLength;
  };
  const object = (id: number, dictionary: string, stream?: Uint8Array) => {
    offsets[id] = length;
    if (!stream) {
      push(`${id} 0 obj\n${dictionary}\nendobj\n`);
      return;
    }
    push(`${id} 0 obj\n${dictionary.replace("LENGTH", String(stream.byteLength))}\nstream\n`);
    push(stream);
    push("\nendstream\nendobj\n");
  };
  const rgb = new Uint8Array(80 * 60 * 3).map((_, index) => (index * 7) % 256);
  const gray = new Uint8Array(8 * 8).fill(128);
  const oneBit = new Uint8Array(6 * 48).fill(0b10101010);
  const inline = "c8".repeat(40 * 40 * 3);
  const page1 =
    "q 80 0 0 60 10 10 cm /Im1 Do Q q 8 0 0 8 100 100 cm /Im2 Do Q " +
    "q 48 0 0 48 100 10 cm /Im3 Do Q " +
    `q 40 0 0 40 150 150 cm BI /W 40 /H 40 /CS /RGB /BPC 8 /F /AHx ID ${inline}> EI Q`;
  const repeat = "q 80 0 0 60 10 10 cm /Im1 Do Q";
  const pageDictionary = (contents: number, images: string) =>
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] " +
    `/Resources << /XObject << ${images} >> >> /Contents ${contents} 0 R >>`;
  const image = (size: number, colorSpace: string, bits: number) =>
    `<< /Type /XObject /Subtype /Image /Width ${size} /Height ${size === 80 ? 60 : size} ` +
    `/ColorSpace /${colorSpace} /BitsPerComponent ${bits} /Length LENGTH >>`;

  push("%PDF-1.7\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, "<< /Type /Pages /Kids [3 0 R 7 0 R 9 0 R] /Count 3 >>");
  object(3, pageDictionary(4, "/Im1 5 0 R /Im2 6 0 R /Im3 10 0 R"));
  object(4, "<< /Length LENGTH >>", text.encode(page1));
  object(5, image(80, "DeviceRGB", 8), rgb);
  object(6, image(8, "DeviceGray", 8), gray);
  object(7, pageDictionary(8, "/Im1 5 0 R"));
  object(8, "<< /Length LENGTH >>", text.encode(repeat));
  object(9, pageDictionary(8, "/Im1 5 0 R"));
  object(10, image(48, "DeviceGray", 1), oneBit);
  const xref = length;
  const rows = offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`);
  push(`xref\n0 ${offsets.length}\n0000000000 65535 f \n${rows.join("")}`);
  push(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return concat(...parts);
}
