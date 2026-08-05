import { createHash, createSign, X509Certificate } from "crypto";
import { Certificate as FidmCertificate } from "@fidm/x509";
import { computeDocumentHash } from "./hash";
import buildSignExtension from "./templates/signExtensionTemplate";
import signedPropertiesFinal, { signedPropertiesForSigning, SignedPropertiesProps } from "./templates/signedPropertiesTemplate";

// التوقيع الرقمي (الختم الإلكتروني) لمستند فوترة إلكترونية وفق زاتكا — منطق مُقتبَس حرفياً من
// `src/zatca/signing/index.ts` في wes4m/zatca-xml-js (رخصة MIT)، مع الاستعاضة عن استخراج معلومات
// الشهادة (الاصدار الخام Raw للمفتاح العام والتوقيع) بمكتبة @fidm/x509 مباشرة (بدل غلاف مخصص) —
// Node.js لا يوفّر هذه المعلومات الخام عبر crypto.X509Certificate المدمجة.

function stripPemHeaders(pem: string, label: string): string {
  return pem
    .replace(`-----BEGIN ${label}-----`, "")
    .replace(`-----END ${label}-----`, "")
    .replace(/\r/g, "")
    .trim();
}

function wrapPem(bodyOrFull: string, label: string): string {
  if (bodyOrFull.includes(`BEGIN ${label}`)) return bodyOrFull;
  return `-----BEGIN ${label}-----\n${bodyOrFull}\n-----END ${label}-----`;
}

export interface CertificateInfo {
  /** تجزئة الشهادة — base64(hex(sha256(body))) — تطابق غرابة الترميز المزدوج في المرجع حرفياً */
  hashBase64: string;
  issuer: string;
  serialNumber: string;
  /** SubjectPublicKeyInfo بترميز DER كاملاً (لا نقطة المنحنى الخام فقط) — هكذا يستخدمها زاتكا
   * فعلياً في وسم QR رقم 8، مطابقةً للتطبيق المرجعي (مُتحقَّق منه: يبدأ بـ 0x30 SEQUENCE). */
  publicKeyRaw: Buffer;
  signatureRaw: Buffer;
}

/** يستخرج تجزئة/مُصدر/رقم تسلسلي/مفتاح عام خام/توقيع خام من شهادة X.509 (PEM أو نص Base64 فقط بلا رأس/تذييل) */
export function getCertificateInfo(certificatePemOrBody: string): CertificateInfo {
  const bodyOnly = stripPemHeaders(certificatePemOrBody, "CERTIFICATE");
  const wrapped = wrapPem(bodyOnly, "CERTIFICATE");

  const hashHex = createHash("sha256").update(bodyOnly).digest("hex");
  const hashBase64 = Buffer.from(hashHex).toString("base64");

  const x509 = new X509Certificate(wrapped);
  const fidmCert = FidmCertificate.fromPEM(Buffer.from(wrapped));

  return {
    hashBase64,
    issuer: x509.issuer.split("\n").reverse().join(", "),
    serialNumber: BigInt(`0x${x509.serialNumber}`).toString(10),
    publicKeyRaw: fidmCert.publicKeyRaw,
    signatureRaw: fidmCert.signature,
  };
}

/** يوقّع تجزئة المستند (base64) بمفتاح secp256k1 خاص — يُرجع التوقيع بترميز base64 */
export function createDigitalSignature(invoiceHashBase64: string, privateKeyPemOrBody: string): string {
  const hashBytes = Buffer.from(invoiceHashBase64, "base64");
  const wrappedKey = wrapPem(stripPemHeaders(privateKeyPemOrBody, "EC PRIVATE KEY"), "EC PRIVATE KEY");
  const sign = createSign("sha256");
  sign.update(hashBytes);
  return sign.sign(wrappedKey).toString("base64");
}

function isoTimestampNoMillis(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * إصلاح مسافات بادئة مُوثَّق (مُقتبَس حرفياً) — مدقّق زاتكا الفعلي يتوقع محتوى <ds:Object> بمسافة
 * بادئة أقل بـ4 أحرف عمّا تنتجه السلسلة الطبيعية بعد التضمين، فيما عدا آخر سطر فيه. لا تفسير رسمي
 * موثّق لهذا من زاتكا نفسها؛ هذا يطابق سلوك المدقّق الفعلي المُلاحَظ في التطبيق المرجعي.
 */
function fixSignedPropertiesIndentation(signedXml: string): string {
  const afterFirstSplit = signedXml.split("<ds:Object>");
  if (afterFirstSplit.length < 2) return signedXml;
  const objectContent = afterFirstSplit[1].split("</ds:Object>")[0];
  const lines = objectContent.split("\n");
  const dedentedLines = lines.map((line) => line.slice(4));

  const linesExceptLast = lines.slice(0, lines.length - 1);
  const dedentedExceptLast = dedentedLines.slice(0, dedentedLines.length - 1);

  return signedXml.replace(linesExceptLast.join("\n"), dedentedExceptLast.join("\n"));
}

export interface SignDocumentParams {
  /** XML غير موقّع من buildDocumentXml — يحتوي <ext:UBLExtensions></ext:UBLExtensions> فارغة والـ QR فارغ */
  xml: string;
  certificatePem: string;
  privateKeyPem: string;
}

export interface SignDocumentResult {
  signedXml: string;
  invoiceHash: string;
  digitalSignature: string;
  certificateInfo: CertificateInfo;
}

export function signDocument({ xml, certificatePem, privateKeyPem }: SignDocumentParams): SignDocumentResult {
  const invoiceHash = computeDocumentHash(xml);
  const certificateInfo = getCertificateInfo(certificatePem);
  const digitalSignature = createDigitalSignature(invoiceHash, privateKeyPem);

  const signedPropertiesProps: SignedPropertiesProps = {
    signTimestamp: isoTimestampNoMillis(new Date()),
    certificateHash: certificateInfo.hashBase64,
    certificateIssuer: certificateInfo.issuer,
    certificateSerialNumber: certificateInfo.serialNumber,
  };

  const signedPropertiesXmlForSigning = signedPropertiesForSigning(signedPropertiesProps);
  const signedPropertiesHashHex = createHash("sha256").update(Buffer.from(signedPropertiesXmlForSigning)).digest("hex");
  const signedPropertiesHash = Buffer.from(signedPropertiesHashHex).toString("base64");

  const signedPropertiesXmlFinal = signedPropertiesFinal(signedPropertiesProps);
  const certificateBody = stripPemHeaders(certificatePem, "CERTIFICATE");

  const extensionXml = buildSignExtension(invoiceHash, signedPropertiesHash, digitalSignature, certificateBody, signedPropertiesXmlFinal);

  let signedXml = xml.replace("<ext:UBLExtensions></ext:UBLExtensions>", `<ext:UBLExtensions>${extensionXml}</ext:UBLExtensions>`);
  signedXml = fixSignedPropertiesIndentation(signedXml);

  return { signedXml, invoiceHash, digitalSignature, certificateInfo };
}
