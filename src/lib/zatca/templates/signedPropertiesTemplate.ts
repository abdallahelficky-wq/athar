/**
 * قالبا XAdES SignedProperties — مُقتبَسان حرفياً من wes4m/zatca-xml-js (رخصة MIT)،
 * `src/zatca/templates/ubl_extension_signed_properties_template.ts`.
 *
 * يوجد قالبان مختلفان عمداً وليس خطأً: القالب الأول (forSigning) يُستخدَم فقط لحساب تجزئة هذا
 * الجزء بمعزل عن بقية المستند — فيُصرَّح فيه بمساحة الاسم xmlns:ds محلياً على كل عنصر لأن C14N
 * لمقطع منعزل يحتاج تصريحات مساحة الاسم كاملة ليكون صحيحاً؛ القالب الثاني (النهائي) يُضمَّن فعلياً
 * داخل <ds:Object> حيث مساحة الاسم ds موروثة من <ds:Signature> الأب فلا داعي لتكرارها.
 */

export interface SignedPropertiesProps {
  signTimestamp: string;
  certificateHash: string;
  certificateIssuer: string;
  certificateSerialNumber: string;
}

const templateForSigning = /* XML */`<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id="xadesSignedProperties">
                                    <xades:SignedSignatureProperties>
                                        <xades:SigningTime>SET_SIGN_TIMESTAMP</xades:SigningTime>
                                        <xades:SigningCertificate>
                                            <xades:Cert>
                                                <xades:CertDigest>
                                                    <ds:DigestMethod xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
                                                    <ds:DigestValue xmlns:ds="http://www.w3.org/2000/09/xmldsig#">SET_CERTIFICATE_HASH</ds:DigestValue>
                                                </xades:CertDigest>
                                                <xades:IssuerSerial>
                                                    <ds:X509IssuerName xmlns:ds="http://www.w3.org/2000/09/xmldsig#">SET_CERTIFICATE_ISSUER</ds:X509IssuerName>
                                                    <ds:X509SerialNumber xmlns:ds="http://www.w3.org/2000/09/xmldsig#">SET_CERTIFICATE_SERIAL_NUMBER</ds:X509SerialNumber>
                                                </xades:IssuerSerial>
                                            </xades:Cert>
                                        </xades:SigningCertificate>
                                    </xades:SignedSignatureProperties>
                                </xades:SignedProperties>`;

const templateFinal = /* XML */`<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id="xadesSignedProperties">
                                <xades:SignedSignatureProperties>
                                    <xades:SigningTime>SET_SIGN_TIMESTAMP</xades:SigningTime>
                                    <xades:SigningCertificate>
                                        <xades:Cert>
                                            <xades:CertDigest>
                                                <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod>
                                                <ds:DigestValue>SET_CERTIFICATE_HASH</ds:DigestValue>
                                            </xades:CertDigest>
                                            <xades:IssuerSerial>
                                                <ds:X509IssuerName>SET_CERTIFICATE_ISSUER</ds:X509IssuerName>
                                                <ds:X509SerialNumber>SET_CERTIFICATE_SERIAL_NUMBER</ds:X509SerialNumber>
                                            </xades:IssuerSerial>
                                        </xades:Cert>
                                    </xades:SigningCertificate>
                                </xades:SignedSignatureProperties>
                            </xades:SignedProperties>`;

function populate(template: string, props: SignedPropertiesProps): string {
  return template
    .replace("SET_SIGN_TIMESTAMP", props.signTimestamp)
    .replace("SET_CERTIFICATE_HASH", props.certificateHash)
    .replace("SET_CERTIFICATE_ISSUER", props.certificateIssuer)
    .replace("SET_CERTIFICATE_SERIAL_NUMBER", props.certificateSerialNumber);
}

export function signedPropertiesForSigning(props: SignedPropertiesProps): string {
  return populate(templateForSigning, props);
}

export default function signedPropertiesFinal(props: SignedPropertiesProps): string {
  return populate(templateFinal, props);
}
