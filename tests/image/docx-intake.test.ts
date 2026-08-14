import { Blob as NativeBlob } from "node:buffer";
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";

import {
  extractDocxImages,
  type DocxConverterAdapter,
  type DocxConverterImage,
} from "../../src/image/docxIntake";
import type { ImageDecodeAdapter } from "../../src/image/imageValidation";
import type { ImageIntakeFailure } from "../../src/image/intakeContracts";

const PNG = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
), (character) => character.charCodeAt(0));

function issueCode(error: unknown): string | undefined {
  return (error as ImageIntakeFailure | undefined)?.issue?.code;
}

async function docxBlob(media = PNG, extra?: readonly [string, Uint8Array]): Promise<Blob> {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  const files: readonly [string, Uint8Array][] = [
    ["[Content_Types].xml", new TextEncoder().encode([
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
      "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">",
      "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>",
      "<Default Extension=\"xml\" ContentType=\"application/xml\"/>",
      "<Default Extension=\"png\" ContentType=\"image/png\"/>",
      "<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>",
      "</Types>",
    ].join(""))],
    ["_rels/.rels", new TextEncoder().encode([
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
      "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
      "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>",
      "</Relationships>",
    ].join(""))],
    ["word/document.xml", new TextEncoder().encode([
      "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
      "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" ",
      "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" ",
      "xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" ",
      "xmlns:pic=\"http://schemas.openxmlformats.org/drawingml/2006/picture\" ",
      "xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\">",
      "<w:body><w:p><w:r><w:drawing><wp:inline><a:graphic><a:graphicData>",
      "<pic:pic><pic:blipFill><a:blip r:embed=\"rId2\"/></pic:blipFill></pic:pic>",
      "</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p><w:sectPr/></w:body></w:document>",
    ].join(""))],
    ["word/_rels/document.xml.rels", new TextEncoder().encode([
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
      "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
      "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"media/image1.png\"/>",
      "</Relationships>",
    ].join(""))],
    ["word/media/image1.png", media],
  ];
  if (extra) (files as [string, Uint8Array][]).push([extra[0], extra[1]]);
  for (const [path, bytes] of files) await writer.add(path, new Uint8ArrayReader(bytes));
  return new NativeBlob([await writer.close()], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  }) as Blob;
}

const decoder: ImageDecodeAdapter = {
  decode: async () => ({ width: 1, height: 1, close: () => undefined }),
};

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

describe("Image DOCX intake", () => {
  it("rejects a nested DOCX payload inside the audited OOXML subtree", async () => {
    // Catches the ZIP→DOCX allowance becoming a recursive nested-archive bypass inside OOXML.
    const nested = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    await expect(extractDocxImages(await docxBlob(PNG, ["word/embeddings/nested.docx", nested]), {
      containerName: "outer.docx",
      containerHash: "a".repeat(64),
      converter: { convertToHtml: async () => ({ value: "", messages: [] }) },
      decoder,
    })).rejects.toSatisfy((error: unknown) => issueCode(error) === "NESTED_ARCHIVE");
  });

  it("accepts a real image-only DOCX with safe Mammoth options and exact media bytes", async () => {
    // Catches Text-oriented nonblank-content requirements or re-encoding of an embedded image occurrence.
    const source = await docxBlob();
    const converter: DocxConverterAdapter = {
      convertToHtml: async (_input, options) => {
        await options.convertImage({ contentType: "image/png", read: async () => base64(PNG) });
        return { value: "<img>", messages: [] };
      },
    };
    const result = await extractDocxImages(source, {
      containerName: "image-only.docx",
      containerHash: "a".repeat(64),
      converter,
      decoder,
      hash: async () => "image-hash",
    });
    expect(result.images).toHaveLength(1);
    const image = result.images[0];
    expect(Array.from(new Uint8Array(await image.sourceBytes.arrayBuffer()))).toEqual(Array.from(PNG));
    expect(image).toMatchObject({
      sourceHash: "image-hash",
      mimeType: "image/png",
      fileExtension: "png",
      width: 1,
      height: 1,
      provenance: {
        intakeKind: "docx-extracted",
        relationshipId: null,
        containerName: "image-only.docx",
        containerHash: "a".repeat(64),
      },
    });
    expect("containerBytes" in image).toBe(false);
  });

  it("retains repeated identical converter callbacks as separate ordered occurrences", async () => {
    // Catches hash deduplication deleting a repeated image relationship or placement.
    let receivedOptions: Record<string, unknown> | null = null;
    const converter: DocxConverterAdapter = {
      convertToHtml: async (_input, options) => {
        receivedOptions = options as unknown as Record<string, unknown>;
        const repeated: DocxConverterImage = {
          contentType: "image/png",
          read: async () => base64(PNG),
        };
        await options.convertImage(repeated);
        await options.convertImage(repeated);
        return { value: "<img><img>", messages: [] };
      },
    };
    const result = await extractDocxImages(await docxBlob(), {
      containerName: "repeat.docx",
      containerHash: "b".repeat(64),
      converter,
      decoder,
      hash: async () => "same-hash",
    });
    expect(result.images).toHaveLength(2);
    expect(result.images.map(({ sourceHash, provenance }) => ({ sourceHash, sourceName: provenance.sourceName }))).toEqual([
      { sourceHash: "same-hash", sourceName: "docx-image-001.png" },
      { sourceHash: "same-hash", sourceName: "docx-image-002.png" },
    ]);
    expect(receivedOptions).toMatchObject({
      includeEmbeddedStyleMap: false,
      externalFileAccess: false,
      ignoreEmptyParagraphs: false,
    });
  });

  it("records unsupported media as a partial issue while preserving safe siblings", async () => {
    // Catches one unsupported DOCX media occurrence rolling back an independently valid image.
    const converter: DocxConverterAdapter = {
      convertToHtml: async (_input, options) => {
        await options.convertImage({ contentType: "image/svg+xml", read: async () => base64(new TextEncoder().encode("<svg/>")) });
        await options.convertImage({ contentType: "image/png", read: async () => base64(PNG) });
        return { value: "<img><img>", messages: [] };
      },
    };
    const result = await extractDocxImages(await docxBlob(), {
      containerName: "mixed.docx",
      containerHash: "b".repeat(64),
      converter,
      decoder,
      hash: async () => "hash",
    });
    expect(result.images).toHaveLength(1);
    expect(result.issues.map(({ code }) => code)).toEqual(["UNSUPPORTED_FORMAT"]);
  });

  it("rejects structural OOXML ambiguity before Mammoth and sanitizes converter failures", async () => {
    // Catches arbitrary ZIPs reaching Mammoth or converter diagnostics exposing source text and local paths.
    let converterCalls = 0;
    const converter: DocxConverterAdapter = {
      convertToHtml: async () => {
        converterCalls += 1;
        throw new Error("/Users/private/secret.docx INTERNAL XML");
      },
    };
    const arbitraryWriter = new ZipWriter(new Uint8ArrayWriter());
    await arbitraryWriter.add("only.txt", new Uint8ArrayReader(new TextEncoder().encode("not docx")));
    const arbitrary = new NativeBlob([await arbitraryWriter.close()]) as Blob;
    await expect(extractDocxImages(arbitrary, {
      containerName: "renamed.docx",
      containerHash: "b".repeat(64),
      converter,
      decoder,
      hash: async () => "hash",
    })).rejects.toSatisfy((error: unknown) => issueCode(error) === "MALFORMED_DOCX");
    expect(converterCalls).toBe(0);

    await expect(extractDocxImages(await docxBlob(), {
      containerName: "broken.docx",
      containerHash: "b".repeat(64),
      converter,
      decoder,
      hash: async () => "hash",
    })).rejects.toSatisfy((error: unknown) => {
      const failure = error as ImageIntakeFailure;
      return failure.issue.code === "MALFORMED_DOCX"
        && !failure.message.includes("Users/private")
        && !failure.message.includes("INTERNAL XML");
    });
  });
});
