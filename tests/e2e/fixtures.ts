import { createHash } from "node:crypto";
import JSZip from "jszip";

export interface BrowserFixture {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

export const textFixture: BrowserFixture = {
  name: "alpha.txt",
  mimeType: "text/plain",
  buffer: Buffer.from("Stable text fact: the café launch code is 314.\n", "utf8"),
};

export const markdownFixture: BrowserFixture = {
  name: "guide.md",
  mimeType: "text/markdown",
  buffer: Buffer.from(
    "# Browser fixture\n\nThe **stable Markdown fact** is 2718.\n\n- First item\n- Second item\n\n[Reference](https://example.invalid/reference)\n",
    "utf8",
  ),
};

export const recoveryTextFixture: BrowserFixture = {
  name: "recoverable.txt",
  mimeType: "text/plain",
  buffer: Buffer.from("Recovery fact: the retained value is 909.\n", "utf8"),
};

export const unsupportedFixture: BrowserFixture = {
  name: "unsupported.rtf",
  mimeType: "application/rtf",
  buffer: Buffer.from("{\\rtf1 deterministic unsupported fixture}", "utf8"),
};

const zipDate = new Date(Date.UTC(1980, 0, 1));

export async function createDocxFixture(): Promise<BrowserFixture> {
  const zip = new JSZip();
  const add = (path: string, value: string) => zip.file(path, value, {
    date: zipDate,
    createFolders: false,
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    unixPermissions: "100644",
  });
  add("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`);
  add("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  add("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`);
  add("word/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:qFormat/></w:style>
</w:styles>`);
  add("word/numbering.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`);
  add("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
  <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Browser DOCX Fixture</w:t></w:r></w:p>
  <w:p><w:r><w:t>Stable DOCX fact: the archive value is 8128.</w:t></w:r></w:p>
  <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Deterministic list item</w:t></w:r></w:p>
  <w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>
</w:body></w:document>`);
  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    platform: "UNIX",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    streamFiles: false,
  });
  return {
    name: "brief.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer,
  };
}

function pdf(objects: readonly string[]): Buffer {
  let output = "%PDF-1.4\n%1234\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(output, "ascii"));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(output, "ascii");
  output += `xref\n0 ${objects.length + 1}\n`;
  output += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) output += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output, "ascii");
}

export function createSelectablePdfFixture(): BrowserFixture {
  const stream = "BT\n/F1 18 Tf\n72 720 Td\n(Stable PDF fact: the vector value is 1618.) Tj\nET\n";
  return {
    name: "evidence.pdf",
    mimeType: "application/pdf",
    buffer: pdf([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
      `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}endstream`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]),
  };
}

export function createTextlessPdfFixture(): BrowserFixture {
  const stream = "q\n0 0 10 10 re\nS\nQ\n";
  return {
    name: "scan-only.pdf",
    mimeType: "application/pdf",
    buffer: pdf([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>",
      `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}endstream`,
    ]),
  };
}

export function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function asPayload(fixture: BrowserFixture) {
  return { name: fixture.name, mimeType: fixture.mimeType, buffer: fixture.buffer };
}
