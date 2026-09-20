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
 * عطل إنتاج فعلي مؤكَّد (أول رد تحقّق فعلي من زاتكا: "invalid-invoice-hash — does not match the
 * calculated Hash of the XML"): كان هذا الملف يطبِّق هنا معالجتين إضافيتين (إدراج أسطر فارغة قبل
 * <cbc:ProfileID> و<cac:AccountingSupplierParty>) مُقتبَستين حرفياً من التطبيق المرجعي
 * (wes4m/zatca-xml-js). تحقَّقنا من سبب وجودهما في المرجع نفسه: طريقة الحذف هناك (`delete` في
 * `src/parser/index.ts`) تعمل على تمثيل الوثيقة ككائن JS مسطَّح (لا DOM حقيقي)، فتفقد كل المسافات
 * البيضاء الأصلية بين العناصر عند إعادة التسلسل — هاتان الإضافتان كانتا تعويضاً يدوياً عن ذلك
 * الفقدان تحديداً في تلك المكتبة.
 *
 * تطبيقنا هنا مختلف بنيوياً: getPureDocumentString أعلاه يستخدم @xmldom/xmldom (DOM حقيقي)
 * ويحذف العناصر المستهدَفة بـ removeChild فقط — عقد النص (المسافات البيضاء) الشقيقة المجاورة
 * للعناصر المحذوفة تبقى في الشجرة كما هي (لم تُحذَف)، فتُكتَب تلقائياً أثناء C14N تماماً كما وردت
 * في القالب الأصلي (invoiceTemplate.ts)، بلا أي فقدان يحتاج تعويضاً. تحقَّقنا من هذا تجريبياً:
 * getPureDocumentString ينتج مسافات صحيحة (مطابقة للقالب) في هذين الموضعين بالضبط *بدون* أي
 * معالجة إضافية — فتطبيق معالجتَي المرجع هنا كان يُكرِّر (يُضاعِف) مسافات موجودة بالفعل، لا يُصلِح
 * نقصاً، وهذا بالضبط ما يُفسِّر عدم تطابق التجزئة مع حساب زاتكا الفعلي. أُزيلتا بالكامل.
 */
export function computeDocumentHash(xml: string): string {
  const pure = getPureDocumentString(xml);
  return createHash("sha256").update(pure).digest("base64");
}
