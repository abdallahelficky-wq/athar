/**
 * قالب إعدادات OpenSSL لتوليد CSR — مُقتبَس حرفياً من wes4m/zatca-xml-js (رخصة MIT)،
 * `src/zatca/templates/csr_template.ts`. القيّم المخصّصة إلزامية بالضبط كما وثّقتها زاتكا (القسم
 * 2.2.2 من معايير الختم الإلكتروني): OID مخصّص (1.3.6.1.4.1.311.20.2) يحدّد نوع الشهادة
 * (اختبار/إنتاج)، SN بصيغة "1-الحل|2-الطراز|3-الرقم التسلسلي"، UID هو الرقم الضريبي.
 */
const template = `
# ------------------------------------------------------------------
# Default section for "req" command options
# ------------------------------------------------------------------
[req]
prompt = no
utf8 = no
distinguished_name = my_req_dn_prompt
req_extensions = v3_req

[ v3_req ]
# Production or Testing Template (TSTZATCA-Code-Signing - ZATCA-Code-Signing)
1.3.6.1.4.1.311.20.2 = ASN1:UTF8String:SET_PRODUCTION_VALUE
subjectAltName=dirName:dir_sect

[ dir_sect ]
# EGS Serial number (1-SolutionName|2-ModelOrVersion|3-serialNumber)
SN = SET_EGS_SERIAL_NUMBER
# VAT Registration number of TaxPayer (Organization identifier [15 digits begins with 3 and ends with 3])
UID = SET_VAT_REGISTRATION_NUMBER
# Invoice type (TSCZ)(1 = supported, 0 not supported) (Tax, Simplified, future use, future use)
title = 0100
# Location (branch address or website)
registeredAddress = SET_BRANCH_LOCATION
# Industry (industry sector name)
businessCategory = SET_BRANCH_INDUSTRY

# ------------------------------------------------------------------
# Section for prompting DN field values to create "subject"
# ------------------------------------------------------------------
[my_req_dn_prompt]
# Common name (EGS TaxPayer PROVIDED ID [FREE TEXT])
commonName = SET_COMMON_NAME

# Organization Unit (Branch name)
organizationalUnitName = SET_BRANCH_NAME

# Organization name (Tax payer name)
organizationName = SET_TAXPAYER_NAME

# ISO2 country code is required with US as default
countryName = SA
`;

export interface CsrConfigProps {
  /** false = شهادة اختبار (Compliance/Sandbox)، true = شهادة إنتاج فعلية */
  production: boolean;
  egsModel: string;
  egsSerialNumber: string;
  solutionName: string;
  vatNumber: string;
  branchLocation: string;
  branchIndustry: string;
  branchName: string;
  taxpayerName: string;
  taxpayerProvidedId: string;
}

export default function populate(props: CsrConfigProps): string {
  return template
    .replace("SET_PRODUCTION_VALUE", props.production ? "ZATCA-Code-Signing" : "TSTZATCA-Code-Signing")
    .replace("SET_EGS_SERIAL_NUMBER", `1-${props.solutionName}|2-${props.egsModel}|3-${props.egsSerialNumber}`)
    .replace("SET_VAT_REGISTRATION_NUMBER", props.vatNumber)
    .replace("SET_BRANCH_LOCATION", props.branchLocation)
    .replace("SET_BRANCH_INDUSTRY", props.branchIndustry)
    .replace("SET_COMMON_NAME", props.taxpayerProvidedId)
    .replace("SET_BRANCH_NAME", props.branchName)
    .replace("SET_TAXPAYER_NAME", props.taxpayerName);
}
