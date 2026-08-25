import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { updateCompany, uploadCompanyLogo, extractCompanyDocument } from "../api/companies";
import AttachmentsPanel from "./shared/AttachmentsPanel";
import CompanyDocumentsPanel from "./CompanyDocumentsPanel";
import LeaseContractsPanel from "./LeaseContractsPanel";
import BranchesPanel from "./BranchesPanel";
import { COUNTRIES, CURRENCIES, countryName, defaultCurrencyForCountry } from "../shared/countries";

const emptyForm = (c) => ({
  name: c.name || "",
  shortName: c.shortName || "",
  nameEn: c.nameEn || "",
  licenseNumber: c.licenseNumber || "",
  unifiedEntityNumber: c.unifiedEntityNumber || "",
  country: c.country || "SA",
  currency: c.currency || "SAR",
  vatNumber: c.vatNumber || "",
  numberingPrefix: c.numberingPrefix || "",
  crNumber: c.crNumber || "",
  crIssueDate: c.crIssueDate ? c.crIssueDate.slice(0, 10) : "",
  crExpiryDate: c.crExpiryDate ? c.crExpiryDate.slice(0, 10) : "",
  officialEmail: c.officialEmail || "",
  phone: c.phone || "",
  addressBuilding: c.addressBuilding || "",
  addressStreet: c.addressStreet || "",
  addressDistrict: c.addressDistrict || "",
  addressCity: c.addressCity || "",
  addressPostalCode: c.addressPostalCode || "",
  addressAdditionalNo: c.addressAdditionalNo || "",
  vatFilingFrequency: c.vatFilingFrequency || "quarterly",
  zakatDeclarationDueDate: c.zakatDeclarationDueDate ? c.zakatDeclarationDueDate.slice(0, 10) : "",
  lowCashThreshold: c.lowCashThreshold ?? "",
  overdueInvoiceDays: c.overdueInvoiceDays ?? 30,
  staleDraftDays: c.staleDraftDays ?? 7,
});

/** نافذة تعديل بيانات الشركة الرسمية الكاملة — شعار، عنوان وطني، تواريخ السجل التجاري،
 * بيانات التواصل، بالإضافة إلى استخراج تلقائي بالذكاء الاصطناعي من المستندات الرسمية. */
export default function CompanyEditModal({ company, onClose, onSaved }) {
  const { t, i18n } = useTranslation();
  const DOC_TYPES = [
    { key: "cr", label: t("settings.companyEdit.docTypeCr") },
    { key: "national_address", label: t("settings.companyEdit.docTypeNationalAddress") },
    { key: "vat_certificate", label: t("settings.companyEdit.docTypeVatCert") },
  ];

  const [form, setForm] = useState(() => emptyForm(company));
  const [logoUrl, setLogoUrl] = useState(company.logoUrl || null);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [extracting, setExtracting] = useState(null); // docType الجاري استخراجه
  const [extractionNote, setExtractionNote] = useState(null); // { confidence, text }
  const [error, setError] = useState("");
  const [attachmentsKey, setAttachmentsKey] = useState(0);

  const logoInputRef = useRef(null);
  const docInputRefs = useRef({});

  const set = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const save = async () => {
    if (!form.name.trim()) { setError(t("settings.companyEdit.errNameRequired")); return; }
    setSaving(true);
    setError("");
    try {
      await updateCompany(company.id, {
        ...form,
        crIssueDate: form.crIssueDate || undefined,
        crExpiryDate: form.crExpiryDate || undefined,
        zakatDeclarationDueDate: form.zakatDeclarationDueDate || undefined,
        lowCashThreshold: form.lowCashThreshold === "" ? null : Number(form.lowCashThreshold),
        overdueInvoiceDays: Number(form.overdueInvoiceDays),
        staleDraftDays: Number(form.staleDraftDays),
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const pickLogo = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingLogo(true);
    setError("");
    try {
      const updated = await uploadCompanyLogo(company.id, file);
      setLogoUrl(updated.logoUrl);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploadingLogo(false);
    }
  };

  const pickDocument = async (docType, e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setExtracting(docType);
    setExtractionNote(null);
    setError("");
    try {
      const result = await extractCompanyDocument(company.id, docType, file);
      setAttachmentsKey((k) => k + 1);
      if (result.confidence === "low" || Object.keys(result.fields).length === 0) {
        setExtractionNote({
          confidence: "low",
          text: t("settings.companyEdit.extractionLowConfidence", { note: result.confidenceNote || t("settings.companyEdit.extractionLowConfidenceDefault") }),
        });
      } else {
        setForm((prev) => ({ ...prev, ...result.fields }));
        setExtractionNote({
          confidence: "high",
          text: t("settings.companyEdit.extractionHighConfidence", { note: result.confidenceNote || "" }),
        });
      }
    } catch (err) {
      setExtractionNote({ confidence: "low", text: t("settings.companyEdit.extractionFailed", { message: err.message }) });
    } finally {
      setExtracting(null);
    }
  };

  return (
    <div className="invoice-modal-overlay" onClick={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <div className="invoice-modal-box">
        <div className="modal-title-row">
          <h3>{t("settings.companyEdit.modalTitle", { name: company.name })}</h3>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={saving} aria-label={t("common.close")}>×</button>
        </div>

        <div className="form-grid">
          <label>{t("settings.companyEdit.nameLabel")}<input type="text" value={form.name} onChange={(e) => set("name", e.target.value)} /></label>
          <label>{t("settings.companyEdit.shortNameLabel")}<input type="text" value={form.shortName} onChange={(e) => set("shortName", e.target.value)} /></label>
          <label>{t("settings.companyEdit.nameEnLabel")}<input type="text" dir="ltr" value={form.nameEn} onChange={(e) => set("nameEn", e.target.value)} /></label>
          <label>
            {t("settings.newCompany.countryLabel")}
            <select value={form.country} onChange={(e) => { set("country", e.target.value); set("currency", defaultCurrencyForCountry(e.target.value)); }}>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>{countryName(c.code, i18n.language)}</option>
              ))}
            </select>
          </label>
          <label>
            {t("settings.newCompany.currencyLabel")}
            <select value={form.currency} onChange={(e) => set("currency", e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>{c.code} — {c.symbolAr}</option>
              ))}
            </select>
          </label>
          <label>{t("settings.companyEdit.vatNumberLabel")}<input type="text" maxLength={15} value={form.vatNumber} onChange={(e) => set("vatNumber", e.target.value.replace(/\D/g, ""))} /></label>
          <label>
            {t("settings.companyEdit.numberingPrefixLabel")}
            <input
              type="text" maxLength={2}
              value={form.numberingPrefix}
              onChange={(e) => set("numberingPrefix", e.target.value.replace(/[^a-zA-Z]/g, "").toUpperCase())}
              placeholder="J"
            />
          </label>

          <label>{t("settings.companyEdit.crNumberLabel")}<input type="text" value={form.crNumber} onChange={(e) => set("crNumber", e.target.value)} /></label>
          <label>{t("settings.companyEdit.crIssueDateLabel")}<input type="date" value={form.crIssueDate} onChange={(e) => set("crIssueDate", e.target.value)} /></label>
          <label>{t("settings.companyEdit.crExpiryDateLabel")}<input type="date" value={form.crExpiryDate} onChange={(e) => set("crExpiryDate", e.target.value)} /></label>
          <label>{t("settings.companyEdit.unifiedEntityNumberLabel")}<input type="text" value={form.unifiedEntityNumber} onChange={(e) => set("unifiedEntityNumber", e.target.value)} /></label>
          <label>{t("settings.companyEdit.licenseNumberLabel")}<input type="text" value={form.licenseNumber} onChange={(e) => set("licenseNumber", e.target.value)} /></label>

          <label>{t("settings.companyEdit.officialEmailLabel")}<input type="email" value={form.officialEmail} onChange={(e) => set("officialEmail", e.target.value)} /></label>
          <label>{t("settings.companyEdit.phoneLabel")}<input type="text" value={form.phone} onChange={(e) => set("phone", e.target.value)} /></label>
        </div>
        <p className="note">{t("settings.companyEdit.numberingPrefixNote")}</p>

        <h4 className="sub-head">{t("settings.companyEdit.addressTitle")}</h4>
        <div className="form-grid">
          <label>{t("settings.companyEdit.addressBuilding")}<input type="text" value={form.addressBuilding} onChange={(e) => set("addressBuilding", e.target.value)} /></label>
          <label>{t("settings.companyEdit.addressStreet")}<input type="text" value={form.addressStreet} onChange={(e) => set("addressStreet", e.target.value)} /></label>
          <label>{t("settings.companyEdit.addressDistrict")}<input type="text" value={form.addressDistrict} onChange={(e) => set("addressDistrict", e.target.value)} /></label>
          <label>{t("settings.companyEdit.addressCity")}<input type="text" value={form.addressCity} onChange={(e) => set("addressCity", e.target.value)} /></label>
          <label>{t("settings.companyEdit.addressPostalCode")}<input type="text" value={form.addressPostalCode} onChange={(e) => set("addressPostalCode", e.target.value)} /></label>
          <label>{t("settings.companyEdit.addressAdditionalNo")}<input type="text" value={form.addressAdditionalNo} onChange={(e) => set("addressAdditionalNo", e.target.value)} /></label>
        </div>

        <h4 className="sub-head">{t("settings.companyEdit.alertsTitle")}</h4>
        <div className="form-grid">
          <label>{t("settings.companyEdit.vatFilingFrequencyLabel")}
            <select value={form.vatFilingFrequency} onChange={(e) => set("vatFilingFrequency", e.target.value)}>
              <option value="monthly">{t("settings.companyEdit.vatFilingMonthly")}</option>
              <option value="quarterly">{t("settings.companyEdit.vatFilingQuarterly")}</option>
            </select>
          </label>
          <label>{t("settings.companyEdit.zakatDueDateLabel")}
            <input type="date" value={form.zakatDeclarationDueDate} onChange={(e) => set("zakatDeclarationDueDate", e.target.value)} />
          </label>
          <label>{t("settings.companyEdit.lowCashThresholdLabel")}
            <input type="number" value={form.lowCashThreshold} onChange={(e) => set("lowCashThreshold", e.target.value)} placeholder={t("settings.companyEdit.lowCashPlaceholder")} />
          </label>
          <label>{t("settings.companyEdit.overdueInvoiceDaysLabel")}
            <input type="number" value={form.overdueInvoiceDays} onChange={(e) => set("overdueInvoiceDays", e.target.value)} />
          </label>
          <label>{t("settings.companyEdit.staleDraftDaysLabel")}
            <input type="number" value={form.staleDraftDays} onChange={(e) => set("staleDraftDays", e.target.value)} />
          </label>
        </div>

        <BranchesPanel companyId={company.id} companyCurrency={form.currency} />
        <LeaseContractsPanel companyId={company.id} />
        <CompanyDocumentsPanel companyId={company.id} />

        <h4 className="sub-head">{t("settings.companyEdit.logoTitle")}</h4>
        <div className="form-btn-group" style={{ justifyContent: "flex-start" }}>
          {logoUrl && <img src={logoUrl} alt={t("settings.companyEdit.logoAlt")} style={{ height: 44, borderRadius: 6 }} />}
          <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={pickLogo} />
          <button className="btn-ghost" onClick={() => logoInputRef.current?.click()} disabled={uploadingLogo}>
            {uploadingLogo ? t("settings.companyEdit.uploadingLogo") : logoUrl ? t("settings.companyEdit.changeLogo") : t("settings.companyEdit.uploadLogo")}
          </button>
        </div>

        <h4 className="sub-head">{t("settings.companyEdit.aiExtractTitle")}</h4>
        <p className="note">{t("settings.companyEdit.aiExtractNote")}</p>
        <div className="form-btn-group" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
          {DOC_TYPES.map((d) => (
            <React.Fragment key={d.key}>
              <input
                ref={(el) => (docInputRefs.current[d.key] = el)}
                type="file" accept="image/*,application/pdf" hidden
                onChange={(e) => pickDocument(d.key, e)}
              />
              <button className="btn-ghost" onClick={() => docInputRefs.current[d.key]?.click()} disabled={extracting !== null}>
                {extracting === d.key ? t("settings.companyEdit.analyzing") : d.label}
              </button>
            </React.Fragment>
          ))}
        </div>
        {extractionNote && (
          <p className={extractionNote.confidence === "low" ? "balance-bad" : "note"}>{extractionNote.text}</p>
        )}

        <AttachmentsPanel key={attachmentsKey} entityType="company" entityId={company.id} title={t("settings.companyEdit.uploadedDocsTitle")} />

        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>{t("common.cancel")}</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? t("settings.myAccount.saving") : t("common.save")}</button>
        </div>
      </div>
    </div>
  );
}
