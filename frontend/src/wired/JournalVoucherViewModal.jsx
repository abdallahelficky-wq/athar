import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { PrintShell, downloadBlob } from "../legacy/shared";
import { fmt, DEPARTMENT_KEYS } from "../legacy/constants";
import { labelForListValue } from "../legacy/listLabels";
import { currencyLabel } from "../shared/countries";
import { getJournalEntry, getJournalEntryPdf } from "../api/journalEntries";
import { formatGregorianDateTime } from "../i18n/dateFormat";
import { getAccountDisplayName } from "./shared/accountDisplayName";
import { useToast, ToastHost } from "./shared/Toast";
import { useAuth } from "../context/AuthContext";
import { canReadHrData } from "../shared/hrAccess";
import { routes } from "../routes";
import "./JournalVoucherViewModal.css";

/** عرض/طباعة سند قيد محاسبي — يُستخدَم من شاشة القيود اليومية وصفحة عرض القيد المستقلة، يفيد من
 * هيدر/فوتر PrintShell المشترك تلقائياً. زر "تحميل PDF" يُنزّل ملفاً حقيقياً من الخادم (نفس آلية
 * توليد PDF المستخدَمة أصلاً لفواتير المبيعات) بدل فتح نافذة طباعة المتصفح.
 *
 * المظهر (بطاقة بشريط علوي ملوّن، شريط بيانات، جدول مخطّط، صف إجمالي مميّز، مربعات توقيع) خاص بهذه
 * الشاشة وحدها (JournalVoucherViewModal.css، تحت .jv-card) — هيدر/فوتر PrintShell المشترك لم يُمسّ.
 * التوقيعات هنا لا من PrintShell (showSignatures=false): «أعدّه» يحمل وقت الإنشاء الفعلي للقيد. */
const LINK_KEYS = ["mirrorEntry", "reversalOfEntry", "reversedByEntry"];

const StatusIcon = ({ posted }) =>
  posted ? (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.7 2.7L16 9.8" /></svg>
  ) : (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
  );

export default function JournalVoucherViewModal({ entry, companies, onClose }) {
  const { t, i18n } = useTranslation();
  const entryNumber = entry.entryNumber || entry.id.slice(-8);
  const { toast, notify, dismiss } = useToast();
  const { user } = useAuth();
  // قيد الرواتب مرتبط بكشفه — التفاصيل لكل موظف في الكشف نفسه، لأدوار الموارد البشرية فقط
  const payrollLink = canReadHrData(user) && entry.sourceModule === "payroll" && entry.sourceId
    ? `${routes.hr("payroll")}?month=${entry.date.slice(0, 7)}`
    : null;

  // روابط المرآة والعكس: سند مطبوع لقيد معكوس (أو عاكس) بلا ما يقول ذلك مستند مضلِّل. القيد القادم من
  // قائمة القيود يحمل المعرّفات فقط؛ getJournalEntry يُرجع تفاصيلها (بنفس إخفاء أسماء الموارد البشرية).
  const hasLinkIds = Boolean(entry.mirrorEntryId || entry.reversalOfEntryId || entry.reversedByEntryId);
  const linksInEntry = LINK_KEYS.some((k) => k in entry);
  const [links, setLinks] = useState(() => (linksInEntry ? entry : null));
  useEffect(() => {
    if (linksInEntry || !hasLinkIds) return undefined;
    let cancelled = false;
    getJournalEntry(entry.id)
      .then((full) => { if (!cancelled) setLinks(full); })
      .catch(() => { /* الروابط معلومات إضافية؛ فشل جلبها لا يمنع عرض السند */ });
    return () => { cancelled = true; };
  }, [entry.id, linksInEntry, hasLinkIds]);

  const handleDownload = async () => {
    try {
      const { blob, filename } = await getJournalEntryPdf(entry.id);
      downloadBlob(blob, filename || `${entryNumber}.pdf`);
    } catch (err) {
      // toast غير حاجب (خلافاً لـ window.alert سابقاً) — تجميد الصفحة كاملة خلف نافذة تنبيه المتصفح
      // كان يبدو وكأن الزر "عالق" على "جارٍ التحميل..." للمستخدم، رغم أن حالته تُصفَّر فعلياً في
      // PrintShell.handleDownloadClick (finally) فور إغلاق تلك النافذة الحاجبة.
      notify(err.message, "error");
    }
  };

  const company = companies?.find((c) => c.id === entry.companyId);
  const total = entry.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const posted = entry.status === "posted";
  const statusText = posted ? t("journalEntries.statusPosted") : t("journalEntries.statusSaved");

  // عمود يُخفى فقط إن كان فارغاً في كل سطور هذا القيد (الفرع كان كذلك أصلاً)
  const hasBranchedLines = entry.lines.some((l) => l.branch);
  const hasCostCenter = entry.lines.some((l) => l.costCenter);
  const hasDepartment = entry.lines.some((l) => l.departmentRef || l.department);
  const hasDescription = entry.lines.some((l) => l.description);
  const labelColumns = 1 + [hasCostCenter, hasDepartment, hasBranchedLines, hasDescription].filter(Boolean).length;

  // التاريخ معزول الاتجاه (LRI…PDI) داخل الجملة العربية حتى لا يُعاد ترتيب أجزائه عند الالتفاف
  const linkDate = (d) => `\u2066${String(d).slice(0, 10)}\u2069`;
  const linkStatus = (s) => (s === "posted" ? t("journalEntries.statusPosted") : t("journalEntries.statusSaved"));
  const linkLines = links
    ? [
        links.mirrorEntry && t("journalEntries.linkInfo.mirror", { company: links.mirrorEntry.companyName, date: linkDate(links.mirrorEntry.date), status: linkStatus(links.mirrorEntry.status) }),
        links.reversalOfEntry && t("journalEntries.linkInfo.reversalOf", { id: links.reversalOfEntry.id.slice(-8), date: linkDate(links.reversalOfEntry.date), status: linkStatus(links.reversalOfEntry.status) }),
        links.reversedByEntry && t("journalEntries.linkInfo.reversedBy", { id: links.reversedByEntry.id.slice(-8), date: linkDate(links.reversedByEntry.date), status: linkStatus(links.reversedByEntry.status) }),
      ].filter(Boolean)
    : [];

  // معادل سطر بعملة فرعه (لو مختلفة عن عملة الشركة وله سعر صرف يدوي مُدخَل) — للعرض فقط، بلا
  // أي تأثير على مبلغ السطر نفسه المُرحَّل بعملة الشركة الأم كما هو دائماً.
  const lineEquivalent = (l, amount) => {
    const branch = l.branch;
    const rate = branch?.exchangeRateToCompanyCurrency ? Number(branch.exchangeRateToCompanyCurrency) : null;
    if (!branch || !company || branch.currency === company.currency || !rate || !amount) return null;
    return (
      <div className="jv-equivalent">
        ≈ {fmt(amount / rate)} {currencyLabel(branch.currency, i18n.language)}
      </div>
    );
  };

  return (
    <>
      <ToastHost toast={toast} onDismiss={dismiss} />
      <PrintShell
        subtitle={t("journalEntries.printModal.subtitle")}
        company={company}
        refNode={
          <>
            <div>{t("journalEntries.table.entryNumber")}: <strong>{entryNumber}</strong></div>
            <div>{t("journalEntries.table.date")}: <strong>{entry.date.slice(0, 10)}</strong></div>
          </>
        }
        onClose={onClose}
        onDownload={handleDownload}
        showSignatures={false}
      >
      <div className="jv-card" data-testid="jv-card">
        <div className="jv-head">
          <div className="jv-head-title">
            <span className="jv-label">{t("journalEntries.table.memo")}</span>
            <strong className="jv-memo">{entry.memo || t("journalEntries.table.noMemo")}</strong>
          </div>
          <span className={"jv-badge " + (posted ? "jv-badge-posted" : "jv-badge-saved")} data-testid="jv-status">
            <StatusIcon posted={posted} />
            {statusText}
          </span>
        </div>

        <div className="jv-meta">
          <div className="jv-meta-item">
            <span className="jv-label">{t("journalEntries.table.entryNumber")}</span>
            <strong>{entryNumber}</strong>
          </div>
          <div className="jv-meta-item">
            <span className="jv-label">{t("journalEntries.table.date")}</span>
            <strong>{entry.date.slice(0, 10)}</strong>
          </div>
          {company?.currency && (
            <div className="jv-meta-item">
              <span className="jv-label">{t("settings.branches.currencyLabel")}</span>
              <strong>{currencyLabel(company.currency, i18n.language)}</strong>
            </div>
          )}
        </div>

        {linkLines.length > 0 && (
          <div className="jv-links" data-testid="jv-links">
            <span className="jv-label">{t("journalEntries.rowActions.links")}</span>
            {linkLines.map((line) => <div key={line}>{line}</div>)}
          </div>
        )}

        {entry.hrCollapsed && <p className="jv-note" data-testid="hr-collapsed-note">{t("journalEntries.hrCollapsed")}</p>}
        {payrollLink && <p className="jv-payroll-link no-print"><Link to={payrollLink} data-testid="payroll-run-link">{t("journalEntries.openPayrollRun")}</Link></p>}

        <div className="jv-table-wrap">
          <table className="jv-table">
            <thead>
              <tr>
                <th>{t("journalEntries.form.lines.account")}</th>
                {hasCostCenter && <th>{t("journalEntries.form.lines.costCenter")}</th>}
                {hasDepartment && <th>{t("journalEntries.form.lines.department")}</th>}
                {hasBranchedLines && <th>{t("journalEntries.form.lines.branch")}</th>}
                {hasDescription && <th>{t("journalEntries.form.lines.description")}</th>}
                <th className="num">{t("statementOfAccount.table.debit")}</th>
                <th className="num">{t("statementOfAccount.table.credit")}</th>
              </tr>
            </thead>
            <tbody>
              {entry.lines.map((l) => (
                <tr key={l.id}>
                  <td>{getAccountDisplayName(l.account, i18n.language)}</td>
                  {hasCostCenter && <td>{l.costCenter?.name || "—"}</td>}
                  {hasDepartment && <td>{l.departmentRef?.name || (l.department ? labelForListValue(t, DEPARTMENT_KEYS, "hr.departmentLabels", l.department) : "—")}</td>}
                  {hasBranchedLines && <td>{l.branch?.nameAr || "—"}</td>}
                  {hasDescription && <td>{l.description || "—"}</td>}
                  <td className="num">{Number(l.debit) ? fmt(Number(l.debit)) : "—"}{lineEquivalent(l, Number(l.debit))}</td>
                  <td className="num">{Number(l.credit) ? fmt(Number(l.credit)) : "—"}{lineEquivalent(l, Number(l.credit))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="jv-total">
                <td colSpan={labelColumns}>{t("journalEntries.form.total")}</td>
                <td className="num">{fmt(total)}</td><td className="num">{fmt(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="jv-signatures">
          <div className="jv-sig">
            <div className="jv-sig-label">{t("common.printShell.preparedBy")}</div>
            <div className="jv-sig-line" />
            <div className="jv-sig-name" data-testid="jv-created-at"><bdi>{formatGregorianDateTime(entry.createdAt, i18n.language)}</bdi></div>
          </div>
          <div className="jv-sig">
            <div className="jv-sig-label">{t("common.printShell.approvedBy")}</div>
            <div className="jv-sig-line" />
            <div className="jv-sig-name">&nbsp;</div>
          </div>
          <div className="jv-sig">
            <div className="jv-sig-label">{t("common.printShell.stamp")}</div>
            <div className="jv-sig-line jv-sig-line-dashed" />
            <div className="jv-sig-name">{t("common.printShell.stampPlaceholder")}</div>
          </div>
        </div>
      </div>
    </PrintShell>
    </>
  );
}
