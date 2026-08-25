import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../../context/AuthContext";
import { QrImage, formatCompanyAddress, printWithOrientation } from "../../../legacy/shared";
import { fmt2 } from "../../../legacy/constants";
import { listCompanyBankAccounts } from "../../../api/companyBankAccounts";

/** يستنتج متصفح/نظام تشغيل/نوع جهاز المستخدم من navigator.userAgent — لمعلومات تدقيق (Audit
 * trail) بسيطة في تذييل الطباعة، بلا أي استدعاء خارجي أو تتبع لعنوان IP (غير متاح بأمان من
 * المتصفح نفسه، ويتطلب خدمة جيولوكيشن خارجية خارج نطاق هذه المهمة). */
function detectClientInfo() {
  const ua = navigator.userAgent || "";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "—";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad|iOS/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "—";
  const deviceType = /Mobile|Android|iPhone/.test(ua) ? "mobile" : /iPad|Tablet/.test(ua) ? "tablet" : "desktop";
  return { browser, os, deviceType };
}

/**
 * قالب فاتورة "كلاسيكي احترافي" — بديل إضافي لـ PrintShell/InvoiceViewModal الحالي (modern)، بُني
 * مطابقاً لعناصر نموذج مرجعي: هيدر ثنائي اللغة، صندوقا مورّد/عميل متوازيان، شريط معلومات أفقي،
 * جدول أصناف بترويسة داكنة وتظليل متبادل، إجماليات + رمز QR (ZATCA الرسمي الوحيد — لا رمز ثانٍ
 * وهمي)، جدول حسابات بنكية عند وجودها، وتذييل داكن بمعلومات تدقيق (من طبع/متى/على أي جهاز).
 * مستقل تماماً عن PrintShell (لا يعدّله ولا يستبدله) — يُستخدَم فقط لما Company.invoiceTemplate
 * === "classicPro"، فيبقى القالب الحالي كما هو تماماً لبقية الشركات.
 */
export default function ClassicProInvoiceView({ invoice, companies, autoPrint, bankAccounts: bankAccountsProp, onClose }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [printedAt, setPrintedAt] = useState(null);
  const [clientInfo] = useState(detectClientInfo);

  const company = companies?.find((c) => c.id === invoice.companyId) || invoice.company;
  const customer = invoice.customer;
  const branch = invoice.branch;
  const accent = company?.brandColor || "#0B5E3B";
  const remaining = Number(invoice.grandTotal) - (invoice.paidAmount || 0);

  // القيمة الحقيقية تُجلَب من الخادم عند عدم تمرير bankAccountsProp صراحة (فاتورة حقيقية) —
  // المعاينة التجريبية من "إعدادات المبيعات" تمرّرها جاهزة (بيانات وهمية) فتتخطى الجلب.
  const [fetchedBankAccounts, setFetchedBankAccounts] = useState([]);
  useEffect(() => {
    if (bankAccountsProp || !company?.id) return;
    listCompanyBankAccounts(company.id).then(setFetchedBankAccounts).catch(() => setFetchedBankAccounts([]));
  }, [bankAccountsProp, company?.id]);
  const bankAccounts = bankAccountsProp || fetchedBankAccounts;

  useEffect(() => {
    if (!autoPrint) return;
    const timer = setTimeout(() => printWithOrientation(false), 200);
    return () => clearTimeout(timer);
  }, [autoPrint, invoice.id]);

  const handlePrint = () => {
    setPrintedAt(new Date());
    setTimeout(() => printWithOrientation(false), 30);
  };

  const companyAddress = formatCompanyAddress(company, { full: true });
  const customerAddress = [customer?.buildingNo && `${t("sales.customers.addressBuilding")} ${customer.buildingNo}`, customer?.street, customer?.district && `${t("sales.customers.city")} ${customer.district}`, customer?.city]
    .filter(Boolean).join("، ");

  return createPortal(
    <div className="cpi-overlay" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="cpi-shell">
        {onClose && <button type="button" className="cpi-close-x" onClick={onClose} aria-label={t("common.close")}>×</button>}
        <div className="cpi-print">
          <div className="cpi-head">
            <div className="cpi-head-title" style={{ color: accent }}>
              {t("salesInvoices.view.standardSubtitle")}
              <span className="cpi-en">Tax Invoice</span>
            </div>
            <div className="cpi-head-company">
              <div className="cpi-head-company-ar">{company?.name}</div>
              {company?.nameEn && <div className="cpi-head-company-en">{company.nameEn}</div>}
            </div>
            <div className="cpi-head-logo">
              {company?.logoUrl && <img src={company.logoUrl} alt={company.name} />}
            </div>
          </div>

          <div className="cpi-parties">
            <div className="cpi-party-box" style={{ borderTopColor: accent }}>
              <div className="cpi-party-title" style={{ color: accent }}>{t("salesInvoices.classicPro.seller")}</div>
              <div className="cpi-row"><strong>{company?.name}</strong></div>
              {branch && <div className="cpi-row">{t("journalEntries.form.branchLabel")}: <strong>{branch.nameAr}</strong></div>}
              {company?.vatNumber && <div className="cpi-row">{t("salesInvoices.view.sellerVat")} <strong>{company.vatNumber}</strong></div>}
              {company?.unifiedEntityNumber && <div className="cpi-row">{t("salesInvoices.classicPro.unifiedEntityNumber")}: <strong>{company.unifiedEntityNumber}</strong></div>}
              {company?.licenseNumber && <div className="cpi-row">{t("salesInvoices.classicPro.licenseNumber")}: <strong>{company.licenseNumber}</strong></div>}
              {companyAddress && <div className="cpi-row">{companyAddress}</div>}
              {company?.phone && <div className="cpi-row">{t("settings.companyEdit.phoneLabel")}: <strong>{company.phone}</strong></div>}
            </div>
            <div className="cpi-party-box" style={{ borderTopColor: accent }}>
              <div className="cpi-party-title" style={{ color: accent }}>{t("salesInvoices.classicPro.buyer")}</div>
              <div className="cpi-row"><strong>{customer?.name}</strong></div>
              <div className="cpi-row">{t("salesInvoices.view.customerVat")} <strong>{customer?.vatNumber || t("salesInvoices.view.vatUnregistered")}</strong></div>
              {customer?.unifiedEntityNumber && <div className="cpi-row">{t("salesInvoices.classicPro.unifiedEntityNumber")}: <strong>{customer.unifiedEntityNumber}</strong></div>}
              {customerAddress && <div className="cpi-row">{customerAddress}</div>}
              {customer?.phone && <div className="cpi-row">{t("sales.customers.phone")}: <strong>{customer.phone}</strong></div>}
            </div>
          </div>

          <div className="cpi-info-bar">
            <div className="cpi-info-cell"><div className="cpi-info-label">{t("salesInvoices.view.invoiceNumber")}</div><div className="cpi-info-value">{invoice.invoiceNumber}</div></div>
            <div className="cpi-info-cell"><div className="cpi-info-label">{t("salesInvoices.view.date")}</div><div className="cpi-info-value">{invoice.date.slice(0, 10)}</div></div>
            {invoice.dueDate && <div className="cpi-info-cell"><div className="cpi-info-label">{t("salesInvoices.form.dueDate")}</div><div className="cpi-info-value">{invoice.dueDate.slice(0, 10)}</div></div>}
            {invoice.customerReference && <div className="cpi-info-cell"><div className="cpi-info-label">{t("salesInvoices.form.customerReference")}</div><div className="cpi-info-value">{invoice.customerReference}</div></div>}
            {invoice.poNumber && <div className="cpi-info-cell"><div className="cpi-info-label">{t("salesInvoices.form.poNumber")}</div><div className="cpi-info-value">{invoice.poNumber}</div></div>}
            {invoice.salesperson && <div className="cpi-info-cell"><div className="cpi-info-label">{t("salesInvoices.form.salesperson")}</div><div className="cpi-info-value">{invoice.salesperson}</div></div>}
            {customer?.paymentTerms && <div className="cpi-info-cell"><div className="cpi-info-label">{t("sales.customers.paymentTerms")}</div><div className="cpi-info-value">{customer.paymentTerms}</div></div>}
            {invoice.otherId && <div className="cpi-info-cell"><div className="cpi-info-label">{t("salesInvoices.form.otherId")}</div><div className="cpi-info-value">{invoice.otherId}</div></div>}
          </div>

          <table className="cpi-items">
            <thead style={{ background: accent }}>
              <tr>
                <th>#</th><th>{t("salesInvoices.view.table.description")}</th><th>{t("salesInvoices.classicPro.unit")}</th>
                <th>{t("salesInvoices.view.table.quantity")}</th><th>{t("salesInvoices.view.table.unitPrice")}</th>
                <th>{t("salesInvoices.view.table.discount")}</th><th>{t("salesInvoices.view.table.beforeTax")}</th>
                <th>{t("salesInvoices.view.table.tax")}</th><th>{t("salesInvoices.view.table.total")}</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((l, i) => (
                <tr key={l.id} className={i % 2 === 1 ? "cpi-alt" : ""}>
                  <td className="num">{i + 1}</td>
                  <td className="cpi-desc">
                    {l.description || l.account?.name}
                    {l.item?.code && <div className="cpi-code">{l.item.code}</div>}
                  </td>
                  <td>{l.item?.unit || t("salesInvoices.classicPro.unit")}</td>
                  <td className="num">{Number(l.quantity)}</td>
                  <td className="num">{fmt2(Number(l.unitPrice))}</td>
                  <td className="num">{Number(l.discountPct)}٪</td>
                  <td className="num">{fmt2(Number(l.subtotal))}</td>
                  <td className="num">{fmt2(Number(l.vat))}</td>
                  <td className="num cpi-amount" style={{ color: accent }}>{fmt2(Number(l.total))}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="cpi-totals-wrap">
            <div className="cpi-qr-wrap">
              <QrImage payload={invoice.qrPayload} size={110} />
              <div>{t("salesInvoices.classicPro.scanToVerify")}</div>
            </div>
            <div className="cpi-totals">
              <div><span>{t("salesInvoices.classicPro.subTotal")}</span><span>{fmt2(Number(invoice.subtotal))}</span></div>
              <div><span>{t("salesInvoices.classicPro.vat")}</span><span>{fmt2(Number(invoice.vatTotal))}</span></div>
              <div className="cpi-grand" style={{ color: accent }}><span>{t("salesInvoices.classicPro.totalDue")}</span><span>{fmt2(Number(invoice.grandTotal))}</span></div>
              <div><span>{t("salesInvoices.classicPro.remaining")}</span><span>{fmt2(remaining)}</span></div>
            </div>
          </div>

          {bankAccounts.length > 0 && (
            <table className="cpi-bank">
              <thead style={{ background: accent }}>
                <tr><th>{t("salesInvoices.classicPro.bankName")}</th><th>{t("salesInvoices.classicPro.accountNumber")}</th><th>{t("salesInvoices.classicPro.iban")}</th></tr>
              </thead>
              <tbody>
                {bankAccounts.map((b, i) => (
                  <tr key={i}><td>{b.bankName}</td><td className="num">{b.accountNumber}</td><td className="num">{b.iban}</td></tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="cpi-footer-bar" style={{ background: accent }}>
            <span>{(printedAt || new Date()).toLocaleDateString(i18n.language === "en" ? "en-US" : "ar-SA")}</span>
            <span>{company?.name}</span>
            <span>{t("salesInvoices.view.invoiceNumber")}: {invoice.invoiceNumber}</span>
          </div>
          <div className="cpi-audit-line">
            {t("salesInvoices.classicPro.printedBy", { name: user?.name || "—" })} | {(printedAt || new Date()).toLocaleString(i18n.language === "en" ? "en-US" : "ar-SA")} | {clientInfo.os} / {clientInfo.browser} / {clientInfo.deviceType}
          </div>
        </div>

        <div className="cpi-actions">
          <button className="btn-primary" onClick={handlePrint}>{t("salesInvoices.form.print")}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
