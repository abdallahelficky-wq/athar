import { createHash } from "crypto";
import { DOMParser, XMLSerializer, type Document as XmldomDocument } from "@xmldom/xmldom";
import { XmlCanonicalizer } from "xmldsigjs";

// تجزئة مستند فوترة إلكترونية وفق زاتكا — منطق مُقتبَس حرفياً (بما فيه معالجات المسافات
// الموثّقة أدناه) من `src/zatca/signing/index.ts` في مكتبة wes4m/zatca-xml-js (رخصة MIT)، مع
// استبدال أداة تحليل/حذف XML الخاصة بهم بـ @xmldom/xmldom (تُنتج نفس شجرة DOM القياسية التي
// تتوقعها xmldsigjs لكل من xmldom الأصلية).

const NS = {
  ext: "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2",
  cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
};

function removeAllByTagNS(doc: XmldomDocument, ns: string, localName: string) {
  const nodes = Array.from(doc.getElementsByTagNameNS(ns, localName));
  for (const node of nodes) {
    node.parentNode?.removeChild(node);
  }
}

/**
 * يحذف (UBLExtensions، غلاف التوقيع Signature، ومرجع مستند QR) من نسخة من XML المستند، ثم
 * يُحوسِب (canonicalize) الناتج بمعيار C14N — تمهيداً لحساب التجزئة. هذه العناصر الثلاثة تُستبعَد
 * لأنها تُضاف/تُعاد حسابها لاحقاً (QR والتوقيع يعتمدان على هذه التجزئة نفسها، فلا يجوز أن تُدرَج
 * ضمن ما يُحسَب).
 */
export function getPureDocumentString(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, "text/xml");

  removeAllByTagNS(doc, NS.ext, "UBLExtensions");
  removeAllByTagNS(doc, NS.cac, "Signature");

  const additionalDocRefs = Array.from(doc.getElementsByTagNameNS(NS.cac, "AdditionalDocumentReference"));
  for (const ref of additionalDocRefs) {
    const idNodes = ref.getElementsByTagNameNS(NS.cbc, "ID");
    if (idNodes.length > 0 && idNodes[0].textContent === "QR") {
      ref.parentNode?.removeChild(ref);
    }
  }

  const strippedXml = new XMLSerializer().serializeToString(doc);
  const strippedDoc = new DOMParser().parseFromString(strippedXml, "text/xml");
  const canonicalizer = new XmlCanonicalizer(false, false);
  // xmldsigjs تنتظر نوع DOM.Node العام (متوافقة مع أي محرّك DOM قياسي)، بينما @xmldom/xmldom
  // يُصدِّر واجهة Document خاصة به بنفس البنية وقت التشغيل لكن غير مطابقة اسمياً لأنواع TS —
  // التحويل هنا آمن لأن كليهما ينفّذ نفس واجهة DOM القياسية فعلياً (مُتحقَّق منه عملياً).
  return canonicalizer.Canonicalize(strippedDoc as unknown as Node);
}

/**
 * تجزئة المستند (Invoice Hash / PIH) وفق زاتكا — SHA-256 بترميز base64 للنص المُحوسَب.
 *
 * السطران أدناه ليسا خطأً أو تجميلاً: هما معالجتان موثّقتان (مُقتبَستان حرفياً من التطبيق
 * المرجعي) لمطابقة سلوك مدقّق زاتكا الفعلي، الذي — لأسباب غير موثّقة رسمياً من زاتكا نفسها —
 * يتوقع سطرين فارغين إضافيين محدَّدين مكانياً في النص المُحوسَب رغم عدم وجودهما في مخرجات C14N
 * القياسية. حذفهما يُنتج تجزئة صحيحة بنيوياً لكن **مختلفة عن** ما يقبله مدقّق زاتكا الحقيقي.
 */
export function computeDocumentHash(xml: string): string {
  let pure = getPureDocumentString(xml);
  pure = pure.replace("<cbc:ProfileID>", "\n    <cbc:ProfileID>");
  pure = pure.replace("<cac:AccountingSupplierParty>", "\n    \n    <cac:AccountingSupplierParty>");
  return createHash("sha256").update(pure).digest("base64");
}
