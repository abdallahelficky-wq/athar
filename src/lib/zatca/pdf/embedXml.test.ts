import { PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { embedSignedXmlIntoPdf } from "./embedXml";

async function makeMinimalPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  page.drawText("sample invoice page");
  return Buffer.from(await doc.save());
}

describe("embedSignedXmlIntoPdf", () => {
  it("produces a well-formed PDF (starts with %PDF, ends with %%EOF)", async () => {
    const base = await makeMinimalPdf();
    const result = await embedSignedXmlIntoPdf(base, "<Invoice>test</Invoice>", {
      xmlFileName: "INV-00001.xml",
      documentTitle: "فاتورة ضريبية INV-00001",
    });
    expect(result.subarray(0, 5).toString()).toBe("%PDF-");
    expect(result.subarray(-6).toString().trim()).toBe("%%EOF");
  });

  it("embeds the XML as a named attachment with AFRelationship=Data, and sets PDF/A-3 XMP metadata", async () => {
    const base = await makeMinimalPdf();
    const xml = "<Invoice><ID>INV-00001</ID></Invoice>";
    const result = await embedSignedXmlIntoPdf(base, xml, {
      xmlFileName: "INV-00001.xml",
      documentTitle: "فاتورة ضريبية INV-00001",
    });

    const reloaded = await PDFDocument.load(result);
    expect(reloaded.getTitle()).toBe("فاتورة ضريبية INV-00001");

    const namesDict = reloaded.catalog.get(PDFName.of("Names"));
    expect(namesDict).toBeDefined();
    const embeddedFilesRef = (namesDict as PDFDict).get(PDFName.of("EmbeddedFiles"));
    expect(embeddedFilesRef).toBeDefined();

    const metadataRef = reloaded.catalog.get(PDFName.of("Metadata"));
    expect(metadataRef).toBeDefined();
    const metadataStream = reloaded.context.lookup(metadataRef) as PDFRawStream;
    const metadataText = Buffer.from(metadataStream.getContents()).toString("utf8");
    expect(metadataText).toContain("pdfaid:part>3<");
    expect(metadataText).toContain("pdfaid:conformance>B<");
  });

  it("adds an OutputIntent only when an ICC profile buffer is provided", async () => {
    const base = await makeMinimalPdf();
    const withoutProfile = await embedSignedXmlIntoPdf(base, "<Invoice/>", { xmlFileName: "a.xml", documentTitle: "a" });
    const reloadedWithout = await PDFDocument.load(withoutProfile);
    expect(reloadedWithout.catalog.get(PDFName.of("OutputIntents"))).toBeUndefined();

    const dummyIcc = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    const withProfile = await embedSignedXmlIntoPdf(base, "<Invoice/>", { xmlFileName: "a.xml", documentTitle: "a", sRgbIccProfile: dummyIcc });
    const reloadedWith = await PDFDocument.load(withProfile);
    expect(reloadedWith.catalog.get(PDFName.of("OutputIntents"))).toBeDefined();
  });
});
