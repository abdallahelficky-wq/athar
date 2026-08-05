import { buildInvoiceHtml, InvoicePdfData } from "./invoiceHtmlTemplate";
import { renderHtmlToPdf } from "./renderPdf";
import { embedSignedXmlIntoPdf } from "./embedXml";

export interface BuildInvoicePdfParams {
  invoiceData: InvoicePdfData;
  signedXml: string;
  xmlFileName: string;
  sRgbIccProfile?: Buffer;
}

/** يبني PDF/A-3 (HTML مرئي مقروء + XML موقّع مُرفَق) لفاتورة/إشعار زاتكا — التنسيق الهجين المطلوب. */
export async function buildInvoicePdf({ invoiceData, signedXml, xmlFileName, sRgbIccProfile }: BuildInvoicePdfParams): Promise<Buffer> {
  const html = buildInvoiceHtml(invoiceData);
  const basePdf = await renderHtmlToPdf(html);
  return embedSignedXmlIntoPdf(basePdf, signedXml, {
    xmlFileName,
    documentTitle: `${invoiceData.documentTitleAr} ${invoiceData.documentNumber}`,
    sRgbIccProfile,
  });
}
