import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { updateCompany } from "../../api/companies";
import InvoiceViewModal from "./InvoiceViewModal";
import ClassicProInvoiceView from "./invoiceTemplates/ClassicProInvoiceView";

const TEMPLATES = [
  { key: "modern", nameKey: "sales.settings.templateModernName", descKey: "sales.settings.templateModernDesc" },
  { key: "classicPro", nameKey: "sales.settings.templateClassicProName", descKey: "sales.settings.templateClassicProDesc" },
];

/** فاتورة وعميل وبنود وهمية بالكامل — لغرض معاينة القالب فقط، لا تُحفَظ ولا تُرسَل لأي API. */
function buildMockInvoice(company, templateKey) {
  const line1 = { id: "mock-1", description: "صنف تجريبي — لوحة إلكترونية", item: { code: "ITM-001", unit: "قطعة" }, quantity: 2, unitPrice: 100, discountPct: 0, subtotal: 200, vat: 30, total: 230, account: { name: "إيرادات المبيعات" } };
  const line2 = { id: "mock-2", description: "صنف تجريبي — كابل شحن", item: { code: "ITM-002", unit: "صندوق" }, quantity: 1, unitPrice: 150, discountPct: 10, subtotal: 135, vat: 20.25, total: 155.25, account: { name: "إيرادات المبيعات" } };
  return {
    id: "preview",
    invoiceNumber: "INV/2026/00001",
    invoiceType: "standard",
    date: new Date().toISOString(),
    dueDate: new Date(Date.now() + 7 * 86400000).toISOString(),
    customerReference: "REF-2026-001",
    poNumber: "PO-2026-01",
    salesperson: "أحمد محمد",
    otherId: "OTH-01",
    companyId: company.id,
    company: { ...company, invoiceTemplate: templateKey },
    branch: null,
    customer: {
      name: "عميل تجريبي للمعاينة", vatNumber: "300000000000003", unifiedEntityNumber: "7000000000",
      buildingNo: "1234", street: "شارع تجريبي", district: "حي تجريبي", city: "الرياض",
      phone: "0500000000", email: "", paymentTerms: "نقدي",
    },
    lines: [line1, line2],
    subtotal: 335, vatTotal: 50.25, grandTotal: 385.25, paidAmount: 0,
    qrPayload: "معاينة تجريبية — بيانات وهمية وليست رمز زاتكا حقيقياً",
  };
}

const MOCK_BANK_ACCOUNTS = [
  { bankName: "مصرف الراجحي", accountNumber: "47000-001-0006089", iban: "SA5780000470608019000117" },
  { bankName: "بنك الرياض", accountNumber: "1681927069940", iban: "SA1220000001681927069940" },
];

/**
 * إعدادات المبيعات — تبويب جديد ضمن موديول المبيعات نفسه (نفس نمط "إعدادات الرواتب" ضمن
 * الموارد البشرية): اختيار قالب فاتورة المبيعات النشط لكل شركة على حدة (كل شركة في المجموعة قد
 * تفضّل قالباً مختلفاً)، مع معاينة تجريبية لكل قالب ببيانات وهمية بحتة قبل الاعتماد.
 */
export default function SalesSettingsTab({ companyId, companies, reloadCompanies }) {
  const { t } = useTranslation();
  const [selectedCompanyId, setSelectedCompanyId] = useState(companyId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [previewTemplate, setPreviewTemplate] = useState(null);

  useEffect(() => { setSelectedCompanyId(companyId); }, [companyId]);

  const company = companies?.find((c) => c.id === selectedCompanyId);

  const chooseTemplate = async (key) => {
    if (!company || company.invoiceTemplate === key) return;
    setSaving(true);
    setError("");
    try {
      await updateCompany(company.id, { invoiceTemplate: key });
      reloadCompanies?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!companies?.length) return <p className="empty">{t("common.noCompany")}</p>;

  return (
    <div>
      <div className="panel form-panel">
        <h3 className="sub-head">{t("sales.settings.templateSectionTitle")}</h3>
        <p className="note">{t("sales.settings.templateSectionNote")}</p>

        {companies.length > 1 && (
          <label className="sales-settings-company-picker">
            {t("sales.settings.companyLabel")}
            <select value={selectedCompanyId || ""} onChange={(e) => setSelectedCompanyId(e.target.value)}>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.shortName || c.name}</option>)}
            </select>
          </label>
        )}

        {error && <p className="balance-bad">{error}</p>}

        {company && (
          <div className="template-picker">
            {TEMPLATES.map((tpl) => {
              const active = company.invoiceTemplate === tpl.key;
              return (
                <div key={tpl.key} className={"template-card" + (active ? " template-card-active" : "")}>
                  <div className={"template-thumb template-thumb-" + tpl.key}>
                    <div className="template-thumb-head" />
                    <div className="template-thumb-line" />
                    <div className="template-thumb-line short" />
                    <div className="template-thumb-table" />
                  </div>
                  <div className="template-card-body">
                    <strong>{t(tpl.nameKey)}</strong>
                    <p className="note">{t(tpl.descKey)}</p>
                    <div className="form-btn-group">
                      <button className="btn-ghost" onClick={() => setPreviewTemplate(tpl.key)}>{t("sales.settings.previewBtn")}</button>
                      {active ? (
                        <span className="template-active-badge">{t("sales.settings.activeTemplate")}</span>
                      ) : (
                        <button className="btn-primary" onClick={() => chooseTemplate(tpl.key)} disabled={saving}>{t("sales.settings.chooseTemplate")}</button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {previewTemplate && company && previewTemplate === "classicPro" && (
        <ClassicProInvoiceView
          invoice={buildMockInvoice(company, previewTemplate)}
          companies={[{ ...company, invoiceTemplate: previewTemplate }]}
          bankAccounts={MOCK_BANK_ACCOUNTS}
          onClose={() => setPreviewTemplate(null)}
        />
      )}
      {previewTemplate && company && previewTemplate === "modern" && (
        <InvoiceViewModal
          invoice={buildMockInvoice(company, previewTemplate)}
          companies={[{ ...company, invoiceTemplate: previewTemplate }]}
          onClose={() => setPreviewTemplate(null)}
        />
      )}
    </div>
  );
}
