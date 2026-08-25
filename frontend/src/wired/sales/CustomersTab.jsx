import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { listCustomers, createCustomer, updateCustomer, deleteCustomer, extractCustomerDocument } from "../../api/customers";
import { fmt } from "../../legacy/constants";
import { Icon } from "../../legacy/shared";
import { useToast, ToastHost } from "../shared/Toast";
import StatementOfAccountModal from "../StatementOfAccountModal";
import AttachmentsPanel from "../shared/AttachmentsPanel";
import { currencyLabel } from "../../shared/countries";
import { routes } from "../../routes";

const emptyForm = (defaultPaymentTerms) => ({
  name: "", customerType: "business", vatNumber: "", crNumber: "", nationalId: "",
  phone: "", email: "", buildingNo: "", street: "", district: "", city: "", postalCode: "", additionalNo: "",
  unifiedEntityNumber: "",
  paymentTerms: defaultPaymentTerms || "نقدي", creditLimit: "",
});

export default function CustomersTab({ companyId, companies }) {
  const { t, i18n } = useTranslation();
  const company = companies?.find((c) => c.id === companyId);
  const currency = currencyLabel(company?.currency, i18n.language);
  const DOC_TYPES = [
    { key: "cr", label: t("sales.customers.docTypeCr") },
    { key: "national_address", label: t("sales.customers.docTypeNationalAddress") },
    { key: "vat_certificate", label: t("sales.customers.docTypeVatCert") },
  ];
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const { toast, notify, dismiss } = useToast();
  const [form, setForm] = useState(emptyForm(company?.defaultPaymentTerms));
  const [editingId, setEditingId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [statementFor, setStatementFor] = useState(null);
  const [extracting, setExtracting] = useState(null); // docType الجاري استخراجه
  const [extractionNote, setExtractionNote] = useState(null); // { confidence, text }
  const [attachmentsKey, setAttachmentsKey] = useState(0);
  const docInputRefs = useRef({});

  // بحث شامل فوري (Live) عبر عدة حقول معاً — عدد العملاء المتوقَّع لأي منشأة صغيرة/متوسطة لا
  // يستدعي رحلة خادم لكل ضغطة مفتاح، فالفلترة تتم محلياً على القائمة المحمَّلة أصلاً بالكامل
  // (listCustomers لا تُصفِّح النتائج حالياً). Debounce خفيف فقط لتفادي إعادة حساب الفلترة مع كل
  // حرف أثناء الكتابة السريعة.
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim().toLowerCase()), 200);
    return () => clearTimeout(timer);
  }, [search]);

  const filteredCustomers = useMemo(() => {
    if (!debouncedSearch) return customers;
    return customers.filter((c) => [c.name, c.crNumber, c.phone, c.email, c.vatNumber]
      .some((field) => (field || "").toLowerCase().includes(debouncedSearch)));
  }, [customers, debouncedSearch]);

  const reload = () => {
    if (!companyId) return;
    setLoading(true);
    listCustomers(companyId).then(setCustomers).catch((e) => notify(e.message, "error")).finally(() => setLoading(false));
  };

  useEffect(reload, [companyId]);

  const openAddForm = () => {
    setEditingId(null);
    setForm(emptyForm(company?.defaultPaymentTerms));
    setExtractionNote(null);
    setFormOpen(true);
  };

  const startEdit = (c) => {
    setEditingId(c.id);
    setForm({ ...emptyForm(company?.defaultPaymentTerms), ...c, creditLimit: c.creditLimit || "" });
    setExtractionNote(null);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setForm(emptyForm(company?.defaultPaymentTerms));
    setExtractionNote(null);
  };

  // نفس آلية استخراج بيانات الشركة من مستند بالضبط (CompanyEditModal.jsx's pickDocument) — يُتاح
  // فقط أثناء تعديل عميل محفوظ فعلاً (editingId)، بنفس نمط "شركة" غير المتاح عند الإضافة الأولى.
  const pickDocument = async (docType, e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !editingId) return;
    setExtracting(docType);
    setExtractionNote(null);
    try {
      const result = await extractCustomerDocument(editingId, docType, file);
      setAttachmentsKey((k) => k + 1);
      if (result.confidence === "low" || Object.keys(result.fields).length === 0) {
        setExtractionNote({
          confidence: "low",
          text: t("sales.customers.extractionLowConfidence", { note: result.confidenceNote || t("sales.customers.extractionLowConfidenceDefault") }),
        });
      } else {
        setForm((prev) => ({ ...prev, ...result.fields }));
        setExtractionNote({
          confidence: "high",
          text: t("sales.customers.extractionHighConfidence", { note: result.confidenceNote || "" }),
        });
      }
    } catch (err) {
      setExtractionNote({ confidence: "low", text: t("sales.customers.extractionFailed", { message: err.message }) });
    } finally {
      setExtracting(null);
    }
  };

  const save = async () => {
    if (!form.name.trim()) return;
    try {
      const payload = { ...form, companyId, creditLimit: form.creditLimit || undefined };
      if (editingId) await updateCustomer(editingId, payload);
      else await createCustomer(payload);
      closeForm();
      reload();
    } catch (err) {
      notify(err.message, "error");
    }
  };

  const remove = async (c) => {
    if (!window.confirm(t("sales.customers.confirmDelete", { name: c.name }))) return;
    try {
      await deleteCustomer(c.id);
      reload();
      notify(t("sales.customers.deleted", { name: c.name }));
    } catch (err) {
      notify(err.message, "error");
    }
  };

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  return (
    <div>
      <div className="panel form-panel">
        <div className="customers-toolbar">
          <div className="quick-search customers-search">
            <span className="quick-search-icon">⌕</span>
            <input
              type="text"
              className="quick-search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("sales.customers.searchPlaceholder")}
            />
          </div>
          <button className="btn-primary" onClick={openAddForm}>{t("sales.customers.addNew")}</button>
        </div>
      </div>

      {loading ? <p className="empty">{t("sales.customers.loading")}</p> : (
        <div className="panel">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>{t("sales.customers.table.name")}</th><th>{t("sales.customers.table.type")}</th>
                <th>{t("sales.customers.table.vatNumber")}</th><th>{t("sales.customers.table.paymentTerms")}</th>
                <th>{t("sales.customers.table.creditLimit")}</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.customerType === "business" ? t("sales.customers.typeBusinessShort") : t("sales.customers.typeIndividualShort")}</td>
                  <td>{c.vatNumber || "—"}</td>
                  <td>{c.paymentTerms || "—"}</td>
                  <td className="num">{c.creditLimit ? fmt(c.creditLimit) : "—"}</td>
                  <td className="row-actions">
                    <button className="icon-btn" title={t("sales.customers.viewStatement")} onClick={() => setStatementFor(c)}><Icon.BookOpen /></button>
                    {c.accountId && (
                      <Link className="icon-btn" title={t("sales.customers.viewInChart")} to={routes.accountLedger(c.accountId)}><Icon.Link /></Link>
                    )}
                    <button className="btn-ghost" onClick={() => startEdit(c)}>{t("sales.customers.edit")}</button>
                    <button className="btn-ghost" onClick={() => remove(c)}>{t("sales.customers.delete")}</button>
                  </td>
                </tr>
              ))}
              {customers.length > 0 && filteredCustomers.length === 0 && (
                <tr><td className="empty" colSpan={6}>{t("sales.customers.noSearchResults")}</td></tr>
              )}
              {customers.length === 0 && <tr><td className="empty" colSpan={6}>{t("sales.customers.empty")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {formOpen && (
        <div className="invoice-modal-overlay" onClick={(e) => e.target === e.currentTarget && closeForm()}>
          <div className="invoice-modal-box">
            <div className="modal-title-row">
              <h3>{editingId ? t("sales.customers.editTitle") : t("sales.customers.addNewTitle")}</h3>
              <button type="button" className="modal-close-btn" onClick={closeForm} aria-label={t("common.close")}>×</button>
            </div>
            <div className="form-grid">
              <label>{t("sales.customers.name")}<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></label>
              <label>{t("sales.customers.type")}
                <select value={form.customerType} onChange={(e) => setForm({ ...form, customerType: e.target.value })}>
                  <option value="business">{t("sales.customers.typeBusiness")}</option>
                  <option value="individual">{t("sales.customers.typeIndividual")}</option>
                </select>
              </label>
              <label>{t("sales.customers.vatNumber")}<input type="text" maxLength={15} value={form.vatNumber} onChange={(e) => setForm({ ...form, vatNumber: e.target.value.replace(/\D/g, "") })} /></label>
              <label>{t("sales.customers.crNumber")}<input type="text" value={form.crNumber} onChange={(e) => setForm({ ...form, crNumber: e.target.value })} /></label>
              <label>{t("sales.customers.unifiedEntityNumber")}<input type="text" value={form.unifiedEntityNumber} onChange={(e) => setForm({ ...form, unifiedEntityNumber: e.target.value })} /></label>
              <label>{t("sales.customers.phone")}<input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
              <label>{t("sales.customers.email")}<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
              <label>{t("sales.customers.paymentTerms")}
                <select value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}>
                  <option value="نقدي">{t("sales.customers.paymentCash")}</option>
                  <option value="آجل 30 يوم">{t("sales.customers.payment30")}</option>
                  <option value="آجل 60 يوم">{t("sales.customers.payment60")}</option>
                  <option value="آجل 90 يوم">{t("sales.customers.payment90")}</option>
                </select>
              </label>
              <label>{t("sales.customers.creditLimit", { currency })}<input type="number" value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })} /></label>
            </div>

            {/* العنوان الوطني الكامل — نفس الحقول والترتيب والتسمية المستخدَمة أصلاً لعنوان الشركة
                نفسها في الإعدادات (CompanyEditModal.jsx)، إلزامية لصحة الفاتورة الإلكترونية (ZATCA). */}
            <h4 className="sub-head">{t("sales.customers.addressTitle")}</h4>
            <div className="form-grid">
              <label>{t("sales.customers.addressBuilding")}<input type="text" value={form.buildingNo} onChange={(e) => setForm({ ...form, buildingNo: e.target.value })} /></label>
              <label>{t("sales.customers.addressStreet")}<input type="text" value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} /></label>
              <label>{t("sales.customers.addressDistrict")}<input type="text" value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} /></label>
              <label>{t("sales.customers.city")}<input type="text" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label>
              <label>{t("sales.customers.addressPostalCode")}<input type="text" value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} /></label>
              <label>{t("sales.customers.addressAdditionalNo")}<input type="text" value={form.additionalNo} onChange={(e) => setForm({ ...form, additionalNo: e.target.value })} /></label>
            </div>

            {/* إرفاق المستندات الرسمية + استخراج تلقائي بالذكاء الاصطناعي — نفس النمط والآلية
                المستخدَمة بالفعل لبيانات الشركة (CompanyEditModal.jsx)، متاح فقط أثناء تعديل عميل
                محفوظ فعلاً (وليس عند الإضافة الأولى)، والبيانات المستخرَجة تُعرَض في حقول النموذج
                القابلة للتعديل أعلاه للمراجعة قبل الحفظ — لا حفظ تلقائي مباشر. */}
            {editingId && (
              <>
                <h4 className="sub-head">{t("sales.customers.aiExtractTitle")}</h4>
                <p className="note">{t("sales.customers.aiExtractNote")}</p>
                <div className="form-btn-group" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
                  {DOC_TYPES.map((d) => (
                    <React.Fragment key={d.key}>
                      <input
                        ref={(el) => (docInputRefs.current[d.key] = el)}
                        type="file" accept="image/*,application/pdf" hidden
                        onChange={(e) => pickDocument(d.key, e)}
                      />
                      <button className="btn-ghost" onClick={() => docInputRefs.current[d.key]?.click()} disabled={extracting !== null}>
                        {extracting === d.key ? t("sales.customers.analyzing") : d.label}
                      </button>
                    </React.Fragment>
                  ))}
                </div>
                {extractionNote && (
                  <p className={extractionNote.confidence === "low" ? "balance-bad" : "note"}>{extractionNote.text}</p>
                )}

                <AttachmentsPanel key={attachmentsKey} entityType="customer" entityId={editingId} title={t("sales.customers.uploadedDocsTitle")} />
              </>
            )}

            <div className="form-btn-group">
              <button className="btn-ghost" onClick={closeForm}>{t("sales.customers.cancel")}</button>
              <button className="btn-primary" onClick={save}>{editingId ? t("sales.customers.saveChanges") : t("sales.customers.saveCustomer")}</button>
            </div>
          </div>
        </div>
      )}

      {statementFor && (
        <StatementOfAccountModal
          kind="customer"
          party={statementFor}
          companyId={companyId}
          companies={companies}
          onClose={() => setStatementFor(null)}
        />
      )}

      <ToastHost toast={toast} onDismiss={dismiss} />
    </div>
  );
}
