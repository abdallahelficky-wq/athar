import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listCompanyBankAccounts } from "../../api/companyBankAccounts";

/**
 * أقسام أسفل الفاتورة المطبوعة: الحسابات البنكية للشركة (من الإعدادات، تُقرأ تلقائياً)، الملاحظات، الشروط والأحكام.
 * كل قسم يظهر فقط عند وجود محتوى. القالب الكلاسيكي يعرض الحسابات البنكية بجدوله الخاص، فيمرّر showBanks={false}.
 * يقابله في PDF الخادم buildInvoiceFooterNotesHtml (src/lib/zatca/pdf/invoiceHtmlTemplate.ts).
 */
export default function InvoiceNotesBlock({ invoice, companyId, showBanks = true, accent }) {
  const { t } = useTranslation();
  const [bankAccounts, setBankAccounts] = useState([]);
  useEffect(() => {
    if (!showBanks || !companyId) return;
    listCompanyBankAccounts(companyId).then(setBankAccounts).catch(() => setBankAccounts([]));
  }, [showBanks, companyId]);

  const notes = (invoice?.notes || "").trim();
  const terms = (invoice?.termsAndConditions || "").trim();
  const banks = showBanks ? bankAccounts : [];
  if (!notes && !terms && banks.length === 0) return null;

  const titleStyle = accent ? { color: accent } : undefined;
  return (
    <div className="invoice-notes-block">
      {banks.length > 0 && (
        <div className="inb-section">
          <div className="inb-title" style={titleStyle}>{t("salesInvoices.notesBlock.bankAccounts")}</div>
          <table className="inb-bank">
            <thead>
              <tr><th>{t("salesInvoices.classicPro.bankName")}</th><th>{t("salesInvoices.classicPro.accountNumber")}</th><th>{t("salesInvoices.classicPro.iban")}</th></tr>
            </thead>
            <tbody>
              {banks.map((b) => (
                <tr key={b.id || b.iban}><td>{b.bankName}</td><td className="num">{b.accountNumber}</td><td className="num">{b.iban}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {notes && (
        <div className="inb-section">
          <div className="inb-title" style={titleStyle}>{t("salesInvoices.notesBlock.notes")}</div>
          <div className="inb-body">{notes}</div>
        </div>
      )}
      {terms && (
        <div className="inb-section">
          <div className="inb-title" style={titleStyle}>{t("salesInvoices.notesBlock.terms")}</div>
          <div className="inb-body">{terms}</div>
        </div>
      )}
    </div>
  );
}
