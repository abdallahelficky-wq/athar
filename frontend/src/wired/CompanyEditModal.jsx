import React, { useRef, useState } from "react";
import { updateCompany, uploadCompanyLogo, extractCompanyDocument } from "../api/companies";
import AttachmentsPanel from "./shared/AttachmentsPanel";
import CompanyDocumentsPanel from "./CompanyDocumentsPanel";
import LeaseContractsPanel from "./LeaseContractsPanel";

const emptyForm = (c) => ({
  name: c.name || "",
  shortName: c.shortName || "",
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

const DOC_TYPES = [
  { key: "cr", label: "رفع السجل التجاري" },
  { key: "national_address", label: "رفع شهادة العنوان الوطني" },
  { key: "vat_certificate", label: "رفع شهادة تسجيل ضريبة القيمة المضافة" },
];

/** نافذة تعديل بيانات الشركة الرسمية الكاملة — شعار، عنوان وطني، تواريخ السجل التجاري،
 * بيانات التواصل، بالإضافة إلى استخراج تلقائي بالذكاء الاصطناعي من المستندات الرسمية. */
export default function CompanyEditModal({ company, onClose, onSaved }) {
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
    if (!form.name.trim()) { setError("الاسم في السجل التجاري مطلوب"); return; }
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
          text: `تعذّر استخراج بيانات دقيقة من هذا المستند — ${result.confidenceNote || "يرجى إدخال البيانات يدوياً ومراجعتها"}.`,
        });
      } else {
        setForm((prev) => ({ ...prev, ...result.fields }));
        setExtractionNote({
          confidence: "high",
          text: `تم استخراج البيانات التالية تلقائياً — راجعها ثم اضغط "حفظ": ${result.confidenceNote || ""}`,
        });
      }
    } catch (err) {
      setExtractionNote({ confidence: "low", text: `فشل رفع/تحليل المستند: ${err.message}` });
    } finally {
      setExtracting(null);
    }
  };

  return (
    <div className="invoice-modal-overlay">
      <div className="invoice-modal-box">
        <h3>بيانات الشركة الرسمية — {company.name}</h3>

        <div className="form-grid">
          <label>الاسم في السجل التجاري<input type="text" value={form.name} onChange={(e) => set("name", e.target.value)} /></label>
          <label>الاسم التجاري (اختياري)<input type="text" value={form.shortName} onChange={(e) => set("shortName", e.target.value)} /></label>
          <label>الرقم الضريبي (VAT)<input type="text" maxLength={15} value={form.vatNumber} onChange={(e) => set("vatNumber", e.target.value.replace(/\D/g, ""))} /></label>
          <label>
            بادئة ترقيم القيود (حرفان، مثال: TP)
            <input
              type="text" maxLength={2}
              value={form.numberingPrefix}
              onChange={(e) => set("numberingPrefix", e.target.value.replace(/[^a-zA-Z]/g, "").toUpperCase())}
              placeholder="بدون ترقيم تسلسلي بعد"
            />
          </label>

          <label>رقم السجل التجاري<input type="text" value={form.crNumber} onChange={(e) => set("crNumber", e.target.value)} /></label>
          <label>تاريخ إصدار السجل التجاري<input type="date" value={form.crIssueDate} onChange={(e) => set("crIssueDate", e.target.value)} /></label>
          <label>تاريخ انتهاء السجل التجاري<input type="date" value={form.crExpiryDate} onChange={(e) => set("crExpiryDate", e.target.value)} /></label>

          <label>البريد الإلكتروني الرسمي<input type="email" value={form.officialEmail} onChange={(e) => set("officialEmail", e.target.value)} /></label>
          <label>رقم الجوال/الهاتف<input type="text" value={form.phone} onChange={(e) => set("phone", e.target.value)} /></label>
        </div>
        <p className="note">
          بادئة الترقيم تُستخدَم لترقيم القيود المحاسبية الجديدة لهذه الشركة تسلسلياً بصيغة
          [البادئة][5 خانات] (مثال: TP00001)، بدءاً من أول قيد بعد ضبطها. لا تُفعَّل هذه الميزة
          لهذه الشركة إلا بعد تحديد البادئة هنا؛ والقيود الأقدم تبقى بأرقامها القديمة كما هي.
        </p>

        <h4 className="sub-head">العنوان الوطني الكامل</h4>
        <div className="form-grid">
          <label>المبنى<input type="text" value={form.addressBuilding} onChange={(e) => set("addressBuilding", e.target.value)} /></label>
          <label>الشارع<input type="text" value={form.addressStreet} onChange={(e) => set("addressStreet", e.target.value)} /></label>
          <label>الحي<input type="text" value={form.addressDistrict} onChange={(e) => set("addressDistrict", e.target.value)} /></label>
          <label>المدينة<input type="text" value={form.addressCity} onChange={(e) => set("addressCity", e.target.value)} /></label>
          <label>الرمز البريدي<input type="text" value={form.addressPostalCode} onChange={(e) => set("addressPostalCode", e.target.value)} /></label>
          <label>الرقم الإضافي<input type="text" value={form.addressAdditionalNo} onChange={(e) => set("addressAdditionalNo", e.target.value)} /></label>
        </div>

        <h4 className="sub-head">إعدادات تنبيهات الداشبورد المالية</h4>
        <div className="form-grid">
          <label>دورية تقديم إقرار ضريبة القيمة المضافة
            <select value={form.vatFilingFrequency} onChange={(e) => set("vatFilingFrequency", e.target.value)}>
              <option value="monthly">شهرية</option>
              <option value="quarterly">ربع سنوية</option>
            </select>
          </label>
          <label>موعد تقديم إقرار الزكاة القادم (اختياري)
            <input type="date" value={form.zakatDeclarationDueDate} onChange={(e) => set("zakatDeclarationDueDate", e.target.value)} />
          </label>
          <label>الحد الأدنى لرصيد الكاش (اختياري)
            <input type="number" value={form.lowCashThreshold} onChange={(e) => set("lowCashThreshold", e.target.value)} placeholder="بدون حد أدنى" />
          </label>
          <label>مدة تأخر الفاتورة قبل التنبيه (أيام)
            <input type="number" value={form.overdueInvoiceDays} onChange={(e) => set("overdueInvoiceDays", e.target.value)} />
          </label>
          <label>مدة بقاء الفاتورة كمسودة قبل التنبيه (أيام)
            <input type="number" value={form.staleDraftDays} onChange={(e) => set("staleDraftDays", e.target.value)} />
          </label>
        </div>

        <LeaseContractsPanel companyId={company.id} />
        <CompanyDocumentsPanel companyId={company.id} />

        <h4 className="sub-head">الشعار</h4>
        <div className="form-btn-group" style={{ justifyContent: "flex-start" }}>
          {logoUrl && <img src={logoUrl} alt="شعار الشركة" style={{ height: 44, borderRadius: 6 }} />}
          <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={pickLogo} />
          <button className="btn-ghost" onClick={() => logoInputRef.current?.click()} disabled={uploadingLogo}>
            {uploadingLogo ? "جارٍ الرفع..." : logoUrl ? "تغيير الشعار" : "رفع شعار"}
          </button>
        </div>

        <h4 className="sub-head">تعبئة تلقائية بالذكاء الاصطناعي من مستند رسمي</h4>
        <p className="note">
          ارفع أياً من المستندات التالية بشكل منفصل ليستخرج النظام الحقول المرتبطة به تلقائياً، وتظهر لك كمعاينة
          في الفورم أعلاه للمراجعة والتعديل قبل الضغط على "حفظ" — لا يُحفظ شيء تلقائياً.
        </p>
        <div className="form-btn-group" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
          {DOC_TYPES.map((d) => (
            <React.Fragment key={d.key}>
              <input
                ref={(el) => (docInputRefs.current[d.key] = el)}
                type="file" accept="image/*,application/pdf" hidden
                onChange={(e) => pickDocument(d.key, e)}
              />
              <button className="btn-ghost" onClick={() => docInputRefs.current[d.key]?.click()} disabled={extracting !== null}>
                {extracting === d.key ? "جارٍ التحليل..." : d.label}
              </button>
            </React.Fragment>
          ))}
        </div>
        {extractionNote && (
          <p className={extractionNote.confidence === "low" ? "balance-bad" : "note"}>{extractionNote.text}</p>
        )}

        <AttachmentsPanel key={attachmentsKey} entityType="company" entityId={company.id} title="المستندات الرسمية المرفوعة" />

        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>إلغاء</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "جارٍ الحفظ..." : "حفظ"}</button>
        </div>
      </div>
    </div>
  );
}
