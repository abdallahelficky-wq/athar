/**
 * توليد حمولة رمز الاستجابة السريعة (QR) بصيغة TLV/Base64 وفق متطلبات هيئة الزكاة والضريبة
 * والجمارك (المرحلة الأولى - Generation Phase). مطابق حرفياً لدالة buildZatcaQrPayload في
 * AtharAlMuhasabi.jsx. لا يغطي المرحلة الثانية (UBL 2.1 موقّعة + CSID + Clearance API)
 * الموضّحة في القسم 6 من ATHAR_BACKEND_SPEC.md، والتي تتطلب تعاقداً مع مزوّد معتمد.
 */
export function buildZatcaQrPayload(
  sellerName: string,
  sellerVat: string,
  isoTimestamp: string,
  invoiceTotal: number,
  vatTotal: number,
): string {
  const encoder = new TextEncoder();
  const tlv = (tag: number, value: string) => {
    const bytes = encoder.encode(String(value || ""));
    return new Uint8Array([tag, bytes.length, ...bytes]);
  };
  const parts = [
    tlv(1, sellerName),
    tlv(2, sellerVat),
    tlv(3, isoTimestamp),
    tlv(4, invoiceTotal.toFixed(2)),
    tlv(5, vatTotal.toFixed(2)),
  ];
  const totalLength = parts.reduce((s, p) => s + p.length, 0);
  const buf = new Uint8Array(totalLength);
  let offset = 0;
  parts.forEach((p) => {
    buf.set(p, offset);
    offset += p.length;
  });
  return Buffer.from(buf).toString("base64");
}
