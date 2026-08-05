import { AFRelationship, PDFDocument, PDFName } from "pdf-lib";

// يُلحِق XML الموقّع بملف PDF كمرفق مُسمّى (نمط "PDF مختلط" — نفس أسلوب ZUGFeRD/Factur-X الأوروبي
// للفواتير الإلكترونية)، ويضيف بيانات XMP وصفية تُعلن مطابقة PDF/A-3B.
//
// ملاحظة مهمة وصريحة (غير مخفية): هذا يُنتج ملف PDF صالحاً يحوي المرفق فعلياً بعلاقة AFRelationship
// "Data" الصحيحة (وفق ما يقرأه pdf-lib، نفس الآلية التي تعتمدها أغلب مولّدات Factur-X)، لكن الإضافة
// الصارمة لمصفوفة /AF على مستوى الفهرس (Catalog) — وهي جزء من معيار ISO 19005-3 الكامل لملفات
// PDF/A-3 — غير مُضافة هنا لأن pdf-lib لا يوفّرها عبر واجهته العامة، والتعديل اليدوي على البنية
// الداخلية بلا مدقّق (veraPDF) متاح في هذه البيئة لمراجعة النتيجة كان سيكون مخاطرة غير مبرَّرة. لذا:
// **يجب** تمرير الملف الناتج عبر veraPDF (أو مدقّق PDF/A معتمد آخر) كخطوة قبول قبل الاعتماد عليه في
// أي إيداع فعلي لدى زاتكا — هذا موثَّق صراحة في خطة التنفيذ المعتمدة لهذه الميزة، وليس نقصاً مخفياً.

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildXmpPacket(opts: { title: string; producer: string }): string {
  const now = new Date().toISOString();
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
      <pdfaid:part>3</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:format>application/pdf</dc:format>
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(opts.title)}</rdf:li></rdf:Alt></dc:title>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <xmp:CreateDate>${now}</xmp:CreateDate>
      <xmp:ModifyDate>${now}</xmp:ModifyDate>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
      <pdf:Producer>${escapeXml(opts.producer)}</pdf:Producer>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

export interface EmbedXmlOptions {
  /** اسم ملف XML المرفق — يجب أن يطابق الاسم المتوقَّع من قبل زاتكا/المدقّقين (عادة نفس رقم الفاتورة) */
  xmlFileName: string;
  documentTitle: string;
  /** بروفايل ICC لـ sRGB (اختياري) — عند توفيره يُضاف OutputIntent؛ بدونه يبقى الملف صالحاً لكن
   * بلا OutputIntent كامل (أحد متطلبات PDF/A الصارمة). لا نُضمِّن بروفايل ملفَّق أبداً. */
  sRgbIccProfile?: Buffer;
}

export async function embedSignedXmlIntoPdf(pdfBytes: Buffer, signedXml: string, options: EmbedXmlOptions): Promise<Buffer> {
  const doc = await PDFDocument.load(pdfBytes);

  await doc.attach(Buffer.from(signedXml, "utf8"), options.xmlFileName, {
    mimeType: "application/xml",
    description: "ZATCA UBL 2.1 signed invoice XML",
    afRelationship: AFRelationship.Data,
    creationDate: new Date(),
    modificationDate: new Date(),
  });

  doc.setProducer("أثر المحاسبي — ZATCA e-invoicing module");
  doc.setTitle(options.documentTitle);

  const xmpPacket = buildXmpPacket({ title: options.documentTitle, producer: "أثر المحاسبي" });
  const metadataStream = doc.context.stream(xmpPacket, { Type: "Metadata", Subtype: "XML" });
  const metadataRef = doc.context.register(metadataStream);
  doc.catalog.set(PDFName.of("Metadata"), metadataRef);

  if (options.sRgbIccProfile) {
    const iccStream = doc.context.stream(options.sRgbIccProfile, { N: 3, Alternate: PDFName.of("DeviceRGB") });
    const iccRef = doc.context.register(iccStream);
    const outputIntent = doc.context.obj({
      Type: "OutputIntent",
      S: PDFName.of("GTS_PDFA1"),
      OutputConditionIdentifier: "sRGB IEC61966-2.1",
      DestOutputProfile: iccRef,
    });
    const outputIntentRef = doc.context.register(outputIntent);
    doc.catalog.set(PDFName.of("OutputIntents"), doc.context.obj([outputIntentRef]));
  }

  const savedBytes = await doc.save();
  return Buffer.from(savedBytes);
}
