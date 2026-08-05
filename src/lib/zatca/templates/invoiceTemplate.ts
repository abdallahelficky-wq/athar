/**
 * قالب UBL 2.1 حرفي — مُقتبَس من مكتبة wes4m/zatca-xml-js مفتوحة المصدر (رخصة MIT) —
 * `src/zatca/templates/simplified_tax_invoice_template.ts`، مع تعميم ثلاث نقاط كانت مُثبَّتة
 * (ProfileID، اسم نوع الفاتورة، محتوى AccountingCustomerParty) لتغطية الفاتورة القياسية أيضاً،
 * لا المبسّطة فقط. البنية والمسافات البادئة (indentation) الأصلية أُبقيت كما هي بالضبط، لأن
 * حساب تجزئة المستند (hash.ts) يعتمد على معالجات مسافات مُوثَّقة مرتبطة بهذا الشكل تحديداً.
 *
 * cbc:InvoiceTypeCode: 388 لكل الأنواع (فاتورة/إشعار دائن 381/إشعار مدين 383 تُمرَّر كنص العنصر).
 * name: 7 أرقام — أول رقمين "01"=قياسية أو "02"=مبسّطة، البقية أعلام (طرف ثالث/اسمية/تصدير/
 * تلخيصية/ذاتية الفوترة) كلها صفر في نظامنا الحالي (لا ندعم أياً منها).
 */
const template = /* XML */`
<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"><ext:UBLExtensions>SET_UBL_EXTENSIONS_STRING</ext:UBLExtensions>

    <cbc:ProfileID>SET_PROFILE_ID</cbc:ProfileID>
    <cbc:ID>SET_INVOICE_SERIAL_NUMBER</cbc:ID>
    <cbc:UUID>SET_TERMINAL_UUID</cbc:UUID>
    <cbc:IssueDate>SET_ISSUE_DATE</cbc:IssueDate>
    <cbc:IssueTime>SET_ISSUE_TIME</cbc:IssueTime>
    <cbc:InvoiceTypeCode name="SET_INVOICE_TYPE_NAME">SET_INVOICE_TYPE</cbc:InvoiceTypeCode>
    <cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>
    <cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>
    SET_BILLING_REFERENCE
    <cac:AdditionalDocumentReference>
        <cbc:ID>ICV</cbc:ID>
        <cbc:UUID>SET_INVOICE_COUNTER_NUMBER</cbc:UUID>
    </cac:AdditionalDocumentReference>
    <cac:AdditionalDocumentReference>
        <cbc:ID>PIH</cbc:ID>
        <cac:Attachment>
            <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">SET_PREVIOUS_INVOICE_HASH</cbc:EmbeddedDocumentBinaryObject>
        </cac:Attachment>
    </cac:AdditionalDocumentReference>
    <cac:AdditionalDocumentReference>
        <cbc:ID>QR</cbc:ID>
        <cac:Attachment>
            <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">SET_QR_CODE_DATA</cbc:EmbeddedDocumentBinaryObject>
        </cac:Attachment>
    </cac:AdditionalDocumentReference>
    <cac:Signature>
        <cbc:ID>urn:oasis:names:specification:ubl:signature:Invoice</cbc:ID>
        <cbc:SignatureMethod>urn:oasis:names:specification:ubl:dsig:enveloped:xades</cbc:SignatureMethod>
    </cac:Signature>
    <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="CRN">SET_COMMERCIAL_REGISTRATION_NUMBER</cbc:ID>
      </cac:PartyIdentification>
      <cac:PostalAddress>
        <cbc:StreetName>SET_STREET_NAME</cbc:StreetName>
        <cbc:BuildingNumber>SET_BUILDING_NUMBER</cbc:BuildingNumber>
        <cbc:PlotIdentification>SET_PLOT_IDENTIFICATION</cbc:PlotIdentification>
        <cbc:CitySubdivisionName>SET_CITY_SUBDIVISION</cbc:CitySubdivisionName>
        <cbc:CityName>SET_CITY</cbc:CityName>
        <cbc:PostalZone>SET_POSTAL_NUMBER</cbc:PostalZone>
        <cac:Country>
          <cbc:IdentificationCode>SA</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>SET_VAT_NUMBER</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>SET_VAT_NAME</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  SET_ACCOUNTING_CUSTOMER_PARTY
  SET_TAX_TOTAL
  SET_LEGAL_MONETARY_TOTAL
  SET_INVOICE_LINES
</Invoice>
`;

const buyerPartyTemplate = /* XML */`<cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="CRN">SET_BUYER_CRN</cbc:ID>
      </cac:PartyIdentification>
      <cac:PostalAddress>
        <cbc:StreetName>SET_BUYER_STREET_NAME</cbc:StreetName>
        <cbc:BuildingNumber>SET_BUYER_BUILDING_NUMBER</cbc:BuildingNumber>
        <cbc:CitySubdivisionName>SET_BUYER_CITY_SUBDIVISION</cbc:CitySubdivisionName>
        <cbc:CityName>SET_BUYER_CITY</cbc:CityName>
        <cbc:PostalZone>SET_BUYER_POSTAL_NUMBER</cbc:PostalZone>
        <cac:Country>
          <cbc:IdentificationCode>SET_BUYER_COUNTRY</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>SET_BUYER_VAT_NUMBER</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>SET_BUYER_NAME</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>`;

const billingReferenceTemplate = /* XML */`<cac:BillingReference>
<cac:InvoiceDocumentReference>
   <cbc:ID>SET_BILLING_REFERENCE_ID</cbc:ID>
</cac:InvoiceDocumentReference>
</cac:BillingReference>`;

export default template;
export { buyerPartyTemplate, billingReferenceTemplate };
