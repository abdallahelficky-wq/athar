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
  /** الجسم القانوني (base64 مفرد، بلا رؤوس PEM) الذي نجح تحليله فعلياً كشهادة X.509 صالحة — قد
   * يختلف عن المُدخَل الأصلي إن كان مُرمَّزاً بـ base64 مرتين (راجع getCertificateInfo أدناه). هذا
   * تحديداً ما يجب تضمينه في <ds:X509Certificate> بالتوقيع، لا المُدخَل الخام كما وصل. */
  canonicalBodyBase64: string;
}

function parseCertificateBody(bodyOnly: string): CertificateInfo {
  const wrapped = wrapPem(bodyOnly, "CERTIFICATE");
  const hashHex = createHash("sha256").update(bodyOnly).digest("hex");
  const x509 = new X509Certificate(wrapped);
  const fidmCert = FidmCertificate.fromPEM(Buffer.from(wrapped));

  return {
    hashBase64: Buffer.from(hashHex).toString("base64"),
    issuer: x509.issuer.split("\n").reverse().join(", "),
    serialNumber: BigInt(`0x${x509.serialNumber}`).toString(10),
    publicKeyRaw: fidmCert.publicKeyRaw,
    signatureRaw: fidmCert.signature,
    canonicalBodyBase64: bodyOnly,
  };
}

/**
 * يستخرج تجزئة/مُصدر/رقم تسلسلي/مفتاح عام خام/توقيع خام من شهادة X.509 (PEM أو نص Base64 فقط
 * بلا رأس/تذييل). تتسامح مع ترميز base64 مزدوج: لو فشل التحليل كما وصلت، تُجرَّب محاولة واحدة
 * بفك ترميز base64 إضافي قبل الاستسلام — حالة حقيقية مُؤكَّدة فعلياً من شركة على الإنتاج (زاتكا
 * أعادت binarySecurityToken مُرمَّزاً مرتين لهذه الشركة تحديداً؛ راجع تشخيص
 * scripts/check-zatca-certificate.ts والتقرير المرتبط). لا نعرف بعد أيّ الشكلين "المعيار" الفعلي
 * لدى زاتكا، فهذا التسامح شبكة أمان ضرورية بصرف النظر — انظر canonicalBodyBase64 في CertificateInfo
 * لمعرفة أيّ شكل نجح فعلياً.
 */
export function getCertificateInfo(certificatePemOrBody: string): CertificateInfo {
  const bodyOnly = stripPemHeaders(certificatePemOrBody, "CERTIFICATE");
  try {
    return parseCertificateBody(bodyOnly);
  } catch (singleEncodedError) {
    const onceDecoded = stripPemHeaders(Buffer.from(bodyOnly, "base64").toString("utf8"), "CERTIFICATE");
    try {
      return parseCertificateBody(onceDecoded);
    } catch {
      // فشلت المحاولتان معاً — نرمي خطأ المحاولة الأولى (الأوضح لشهادة تالفة فعلياً بلا علاقة
      // بترميز مزدوج على الإطلاق)، لا خطأ محاولة فك الترميز الإضافي الأقل دلالة لقارئ الخطأ.
      throw singleEncodedError;
    }
  }
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
  // certificateInfo.canonicalBodyBase64 عمداً هنا، لا stripPemHeaders(certificatePem, ...) مباشرة:
  // لو كانت الشهادة المخزَّنة مُرمَّزة base64 مرتين، getCertificateInfo أعلاه تسامح مع ذلك واستخرج
  // معلوماتها من الشكل الصحيح بعد فك الترميز الإضافي — يجب تضمين نفس الشكل الصحيح هذا بالضبط في
  // <ds:X509Certificate>، لا الجسم الخام المُرمَّز مرتين كما وصل، وإلا كانت زاتكا لتستلم شهادة
  // غير قابلة للتحليل فعلياً في المستند الموقَّع نفسه رغم نجاح التوقيع محلياً.
  const certificateBody = certificateInfo.canonicalBodyBase64;

  const extensionXml = buildSignExtension(invoiceHash, signedPropertiesHash, digitalSignature, certificateBody, signedPropertiesXmlFinal);

  const signedXml = xml.replace("<ext:UBLExtensions></ext:UBLExtensions>", `<ext:UBLExtensions>${extensionXml}</ext:UBLExtensions>`);

  return { signedXml, invoiceHash, digitalSignature, certificateInfo };
}
