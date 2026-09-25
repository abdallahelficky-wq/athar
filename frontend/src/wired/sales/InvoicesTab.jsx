import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { searchSalesInvoices, getSalesInvoice, deleteSalesInvoice, unpostSalesInvoice, sendInvoiceEmail, resendInvoiceZatca, retryInvoiceZatcaSubmission } from "../../api/salesInvoices";
import { fmt } from "../../legacy/constants";
import { currencyLabel } from "../../shared/countries";
import { currentFiscalYearStartDateOnly, todayDateOnly } from "../../shared/fiscalYear";
import { routes } from "../../routes";
import { Icon } from "../../legacy/shared";
import { useToast, ToastHost } from "../shared/Toast";
import UnpostModal from "../shared/UnpostModal";
import ActionsMenu from "../shared/ActionsMenu";
import FilterBar from "../shared/FilterBar";
import PaginationBar from "../shared/PaginationBar";
import SortableTh from "../shared/SortableTh";
import CustomerPicker from "../shared/CustomerPicker";
import { useUrlQueryState } from "../shared/useUrlQueryState";
import { useDebouncedValue } from "../shared/useDebouncedValue";
import InvoiceFormModal from "./InvoiceFormModal";
import InvoiceViewModal from "./InvoiceViewModal";
import JournalEntryViewModal from "./JournalEntryViewModal";
import LinkPaymentModal from "./LinkPaymentModal";
import PostedBlockModal from "./PostedBlockModal";
import SendInvoiceEmailModal from "./SendInvoiceEmailModal";
import ReprintReceiptModal from "./ReprintReceiptModal";

import { invoiceZatcaState } from "./invoiceZatcaState";

const PAGE_SIZE_OPTIONS = [15, 25, 50, 100, 200];
const INVOICE_TYPE_OPTIONS = ["standard", "simplified"];
const POSTING_STATUS_OPTIONS = ["draft", "posted", "pending_submission", "zatca_accepted_posting_incomplete"];
const PAYMENT_STATUS_OPTIONS = ["مسددة", "مسددة جزئياً", "غير مسددة"];
const ZATCA_STATUS_OPTIONS = ["sent", "sent_with_notes", "not_sent", "not_applicable"];

const FILTER_DEFAULTS = {
  q: "", dateFrom: "", dateTo: "", amountMin: "", amountMax: "", customerId: "",
  invoiceType: "", status: "", paymentStatus: "", zatcaStatus: "",
  sortBy: "date", sortDir: "desc", page: 1, pageSize: 25,
};
const DRAFT_KEYS = ["dateFrom", "dateTo", "amountMin", "amountMax", "customerId", "invoiceType", "status", "paymentStatus", "zatcaStatus"];
const EMPTY_SUMMARY = { count: 0, netTotal: "0", vatTotal: "0", grandTotal: "0" };

// حالة الفاتورة أصبحت أربع قيم ممكنة منذ إصلاح مسار الترحيل الآمن على ثلاث مراحل لزاتكا، لا
// اثنتين فقط (posted/draft) كما كانت — pending_submission وzatca_accepted_posting_incomplete
// عطل إنتاج فعلي كانا سيُعرَضان خطأً كـ"مسودة" لو استُخدم فحص ثنائي بسيط هنا (posted ? .. : draft)،
// موهماً بأن الفاتورة لم تُرقَّم/تُحجز لها سلسلة زاتكا بعد بينما هي فعلياً محجوزة ومُرسَلة أو
// مُستلَم ردّها بالفعل، فقط الترحيل المحلي (قيد/مخزون) لم يكتمل.
function postingStatusLabel(status, t) {
  if (status === "posted") return t("salesInvoices.table.posted");
  if (status === "pending_submission") return t("salesInvoices.table.pendingSubmission");
  if (status === "zatca_accepted_posting_incomplete") return t("salesInvoices.table.postingIncomplete");
  return t("salesInvoices.table.draft");
}

// مطابقة لِـ retryStatuses وclassName في invoiceZatcaState.js — مُعادة هنا محلياً بدل استيرادها لأن
// صفوف /sales-invoices/search الخفيفة لا تحمل zatcaResponseRaw الكامل (تُجلَب فقط عند فتح فاتورة
// بعينها)، فقرار "canResend"/تلوين الشارة هنا مبني على status/zatcaStatus وحدهما (كافيان لهما،
// zatcaGroup نفسه محسوب مسبقاً في الخادم بنفس منطق الملف).
const ZATCA_RETRY_STATUSES = new Set(["not_submitted", "rejected", "submission_failed", "certificate_error", "compliance_checked"]);
function canResendZatca(row) {
  return ["posted", "pending_submission"].includes(row.status) && ZATCA_RETRY_STATUSES.has(row.zatcaStatus);
}
function zatcaGroupClassName(group) {
  return `status-badge ${group === "sent" ? "status-posted" : group === "not_applicable" ? "status-neutral" : "status-warning"}`;
}

export default function InvoicesTab({ companyId, companies }) {
  const { t, i18n } = useTranslation();
  const [urlState, setUrlState] = useUrlQueryState(FILTER_DEFAULTS);
  const [result, setResult] = useState({ items: [], totalCount: 0, summary: EMPTY_SUMMARY });
  const [loading, setLoading] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);
  const { toast, notify, dismiss } = useToast();

  const [qInput, setQInput] = useState(urlState.q);
  const debouncedQ = useDebouncedValue(qInput, 400);
  useEffect(() => { setQInput(urlState.q); }, [urlState.q]);
  useEffect(() => {
    if (debouncedQ !== urlState.q) setUrlState({ q: debouncedQ, page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  const [draft, setDraft] = useState(() => Object.fromEntries(DRAFT_KEYS.map((k) => [k, urlState[k]])));
  useEffect(() => {
    setDraft(Object.fromEntries(DRAFT_KEYS.map((k) => [k, urlState[k]])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...DRAFT_KEYS.map((k) => urlState[k])]);

  const [formModal, setFormModal] = useState(null);
  const [viewInvoice, setViewInvoice] = useState(null);
  const [autoPrint, setAutoPrint] = useState(false);
  const [journalInvoice, setJournalInvoice] = useState(null);
  const [linkPaymentInvoice, setLinkPaymentInvoice] = useState(null);
  const [blockModal, setBlockModal] = useState(null);
  const [unpostTarget, setUnpostTarget] = useState(null);
  const [emailModalInvoice, setEmailModalInvoice] = useState(null);
  const [sendingEmailId, setSendingEmailId] = useState(null);
  const [resendingZatcaId, setResendingZatcaId] = useState(null);
  const [reprintInvoice, setReprintInvoice] = useState(null);

  const reload = () => setReloadTick((n) => n + 1);

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    searchSalesInvoices(companyId, urlState)
      .then(setResult)
      .catch((e) => notify(e.message, "error"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, JSON.stringify(urlState), reloadTick]);

  if (!companyId) return <p className="empty">{t("salesInvoices.noCompany")}</p>;

  const currency = currencyLabel(companies?.find((c) => c.id === companyId)?.currency, i18n.language);
  const money = (n) => `${fmt(Number(n))} ${currency}`;

  const applyDraft = () => setUrlState({ ...draft, page: 1 });
  const resetFilters = () => {
    setDraft(Object.fromEntries(DRAFT_KEYS.map((k) => [k, FILTER_DEFAULTS[k]])));
    setQInput("");
    setUrlState({ ...FILTER_DEFAULTS });
  };

  const onSort = (sortBy, sortDir) => setUrlState({ sortBy, sortDir, page: 1 });

  // كل الإجراءات التي تفتح نافذة تحرير/عرض/طباعة تحتاج بيانات الفاتورة الكاملة (السطور، العميل
  // الكامل، سندات القبض المرتبطة...) غير الموجودة في صف القائمة الخفيف — تُجلَب عند الطلب فقط.
  const withFullInvoice = async (id, then) => {
    try {
      const full = await getSalesInvoice(id);
      then(full);
    } catch (err) {
      notify(err.message, "error");
    }
  };

  const onSaved = (message) => {
    setFormModal(null);
    reload();
    notify(message);
  };

  const onEditClick = (row) => {
    if (row.status === "posted") { setBlockModal({ invoice: row, action: t("salesInvoices.blockAction.edit") }); return; }
    withFullInvoice(row.id, (full) => setFormModal({ mode: "edit", invoice: full }));
  };

  const onDeleteClick = async (row) => {
    if (row.status === "posted") { setBlockModal({ invoice: row, action: t("salesInvoices.blockAction.delete") }); return; }
    if (Number(row.paidAmount) > 0) {
      notify(t("salesInvoices.notify.linkedToReceipt"), "error");
      return;
    }
    if (!window.confirm(t("salesInvoices.notify.confirmDelete", { number: row.invoiceNumber }))) return;
    try {
      await deleteSalesInvoice(row.id);
      reload();
      notify(t("salesInvoices.notify.deleted", { number: row.invoiceNumber }));
    } catch (err) {
      notify(err.message, "error");
    }
  };

  const onDuplicateClick = (row) => withFullInvoice(row.id, (full) => setFormModal({ mode: "duplicate", invoice: full }));

  const doUnpost = async (pin) => {
    await unpostSalesInvoice(unpostTarget.id, pin);
    const num = unpostTarget.invoiceNumber;
    setUnpostTarget(null);
    reload();
    notify(t("salesInvoices.notify.unposted", { number: num }));
  };

  const onUnpostedFromBlock = (updated) => {
    setBlockModal(null);
    reload();
    notify(t("salesInvoices.notify.unpostedFromBlock", { number: updated.invoiceNumber }));
  };

  const onPrintClick = (row) => withFullInvoice(row.id, (full) => { setViewInvoice(full); setAutoPrint(true); });
  const onViewClick = (row) => withFullInvoice(row.id, setViewInvoice);
  const onLinkPaymentClick = (row) => withFullInvoice(row.id, setLinkPaymentInvoice);
  const onReprintClick = (row) => withFullInvoice(row.id, setReprintInvoice);
  const onJournalClick = (row) => { if (row.journalEntryId) setJournalInvoice({ journalEntryId: row.journalEntryId }); };

  const onSendEmailClick = async (row) => {
    if (row.customerEmail) {
      setSendingEmailId(row.id);
      try {
        const result = await sendInvoiceEmail(row.id);
        reload();
        notify(
          result.sent ? t("salesInvoices.notify.emailSent", { number: row.invoiceNumber, email: row.customerEmail }) : t("salesInvoices.notify.emailFailed"),
          result.sent ? "success" : "error",
        );
      } catch (err) {
        notify(err.message, "error");
      } finally {
        setSendingEmailId(null);
      }
      return;
    }
    setEmailModalInvoice(row);
  };

  const onResendZatcaClick = async (row) => {
    if (resendingZatcaId) return;
    setResendingZatcaId(row.id);
    try {
      const updated = await (row.status === "pending_submission" ? retryInvoiceZatcaSubmission(row.id) : resendInvoiceZatca(row.id));
      reload();
      const badgeLabel = t(`salesInvoices.zatcaSummary.${invoiceZatcaState(updated).key}`);
      const stillFailing = !["sent", "sent_with_notes"].includes(invoiceZatcaState(updated).key);
      notify(
        updated.zatcaStatus === "submission_failed"
          ? t("salesInvoices.notify.zatcaStillUnreachable", { number: row.invoiceNumber })
          : updated.zatcaStatus === "certificate_error"
            ? t("salesInvoices.notify.zatcaCertificateStillInvalid", { number: row.invoiceNumber })
            : updated.zatcaStatus === "compliance_checked"
              ? t("salesInvoices.notify.zatcaStillComplianceOnly", { number: row.invoiceNumber })
              : stillFailing
                ? t("salesInvoices.notify.zatcaRejectedAgain", { number: row.invoiceNumber, reason: updated.rejectionReason ? `: ${updated.rejectionReason}` : "." })
                : t("salesInvoices.notify.zatcaResentOk", { number: row.invoiceNumber, status: badgeLabel }),
        stillFailing && updated.zatcaStatus !== "compliance_checked" ? "error" : "success",
      );
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setResendingZatcaId(null);
    }
  };

  const colSpan = 8;
  const items = result.items;
  const summary = result.summary || EMPTY_SUMMARY;

  return (
    <div>
      <div className="form-btn-group" style={{ justifyContent: "flex-start", marginBottom: 14 }}>
        <button className="btn-primary" onClick={() => setFormModal({ mode: "create" })}>{t("salesInvoices.addInvoice")}</button>
      </div>

      <FilterBar onSearch={applyDraft} onReset={resetFilters}>
        <label>
          {t("salesInvoices.search.quickSearchLabel")}
          <input type="text" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder={t("filters.quickSearchPlaceholder")} />
        </label>
        <label>
          {t("filters.dateFrom")}
          <input type="date" value={draft.dateFrom} onChange={(e) => setDraft((d) => ({ ...d, dateFrom: e.target.value }))} />
        </label>
        <label>
          {t("filters.dateTo")}
          <input type="date" value={draft.dateTo} onChange={(e) => setDraft((d) => ({ ...d, dateTo: e.target.value }))} />
        </label>
        <label>
          {t("filters.amountMin")}
          <input type="number" step="0.01" value={draft.amountMin} onChange={(e) => setDraft((d) => ({ ...d, amountMin: e.target.value }))} />
        </label>
        <label>
          {t("filters.amountMax")}
          <input type="number" step="0.01" value={draft.amountMax} onChange={(e) => setDraft((d) => ({ ...d, amountMax: e.target.value }))} />
        </label>
        <label>
          {t("filters.customer")}
          <CustomerPicker companyId={companyId} value={draft.customerId} onChange={(id) => setDraft((d) => ({ ...d, customerId: id }))} />
        </label>
        <label>
          {t("salesInvoices.search.invoiceTypeLabel")}
          <select value={draft.invoiceType} onChange={(e) => setDraft((d) => ({ ...d, invoiceType: e.target.value }))}>
            <option value="">{t("salesInvoices.search.invoiceTypeAll")}</option>
            {INVOICE_TYPE_OPTIONS.map((v) => (
              <option key={v} value={v}>{t(`salesInvoices.search.invoiceType${v === "standard" ? "Standard" : "Simplified"}`)}</option>
            ))}
          </select>
        </label>
        <label>
          {t("salesInvoices.search.postingStatusLabel")}
          <select value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}>
            <option value="">{t("salesInvoices.search.postingStatusAll")}</option>
            {POSTING_STATUS_OPTIONS.map((v) => (
              <option key={v} value={v}>{postingStatusLabel(v, t)}</option>
            ))}
          </select>
        </label>
        <label>
          {t("salesInvoices.search.paymentStatusLabel")}
          <select value={draft.paymentStatus} onChange={(e) => setDraft((d) => ({ ...d, paymentStatus: e.target.value }))}>
            <option value="">{t("salesInvoices.search.paymentStatusAll")}</option>
            {PAYMENT_STATUS_OPTIONS.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          {t("salesInvoices.zatcaStatusFilterLabel")}
          <select value={draft.zatcaStatus} onChange={(e) => setDraft((d) => ({ ...d, zatcaStatus: e.target.value }))}>
            <option value="">{t("salesInvoices.search.zatcaStatusAll")}</option>
            {ZATCA_STATUS_OPTIONS.map((key) => (
              <option key={key} value={key}>{t(`salesInvoices.zatcaSummary.${key}`)}</option>
            ))}
          </select>
        </label>
      </FilterBar>

      {loading ? <p className="empty">{t("salesInvoices.loading")}</p> : (
        <div className="panel">
          <table className="ledger-table responsive-table">
            <thead>
              <tr>
                <SortableTh label={t("salesInvoices.table.number")} sortKey="invoiceNumber" sort={urlState} onSort={onSort} />
                <SortableTh label={t("salesInvoices.table.customer")} sortKey="customerName" sort={urlState} onSort={onSort} />
                <SortableTh label={t("salesInvoices.table.date")} sortKey="date" sort={urlState} onSort={onSort} />
                <SortableTh label={t("salesInvoices.table.total")} sortKey="grandTotal" sort={urlState} onSort={onSort} className="num" />
                <th>{t("salesInvoices.table.postingStatus")}</th>
                <th>{t("salesInvoices.table.paymentStatus")}</th>
                <th>{t("salesInvoices.table.zatcaStatus")}</th>
                <th>{t("salesInvoices.table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const posted = row.status === "posted";
                const linked = Number(row.paidAmount) > 0;
                return (
                  <tr key={row.id}>
                    <td data-label={t("salesInvoices.table.number")}>{row.invoiceNumber}</td>
                    <td data-label={t("salesInvoices.table.customer")}>
                      <Link
                        className="drill-link"
                        to={routes.customerStatement(row.customerId, row.companyId, currentFiscalYearStartDateOnly(), todayDateOnly())}
                      >
                        {row.customerName}
                      </Link>
                    </td>
                    <td data-label={t("salesInvoices.table.date")}>{row.date.slice(0, 10)}</td>
                    <td className="num" data-label={t("salesInvoices.table.total")}>{fmt(Number(row.grandTotal))}</td>
                    <td data-label={t("salesInvoices.table.postingStatus")}><span className="status-badge">{postingStatusLabel(row.status, t)}</span></td>
                    <td data-label={t("salesInvoices.table.paymentStatus")}><span className="status-badge">{row.paymentStatus}</span></td>
                    <td data-label={t("salesInvoices.table.zatcaStatus")}>
                        <button type="button" className={zatcaGroupClassName(row.zatcaGroup)} onClick={() => onViewClick(row)}>
                          {t(`salesInvoices.zatcaSummary.${row.zatcaGroup}`)}
                        </button>
                        {canResendZatca(row) && <button type="button" className="btn-secondary" disabled={!!resendingZatcaId} onClick={() => onResendZatcaClick(row)}>
                          {t(resendingZatcaId === row.id ? "salesInvoices.zatcaSummary.sending" : "salesInvoices.zatcaSummary.resend")}
                        </button>}
                    </td>
                    <td className="row-actions">
                      <button className="icon-btn" title={t("salesInvoices.actionsMenu.view")} onClick={() => onViewClick(row)}><Icon.Eye /></button>
                      <button className="icon-btn" title={t("salesInvoices.actionsMenu.edit")} onClick={() => onEditClick(row)}><Icon.Edit /></button>
                      {posted && <button className="icon-btn icon-btn-warn" title={t("salesInvoices.actionsMenu.unpost")} onClick={() => setUnpostTarget(row)}><Icon.Unlock /></button>}
                      <button className="icon-btn icon-btn-danger" title={t("salesInvoices.actionsMenu.delete")} onClick={() => onDeleteClick(row)}><Icon.Trash /></button>
                      <ActionsMenu
                        items={[
                          { label: t("salesInvoices.actionsMenu.print"), icon: Icon.Printer, onClick: () => onPrintClick(row) },
                          { label: t("salesInvoices.actionsMenu.duplicate"), icon: Icon.Copy, onClick: () => onDuplicateClick(row) },
                          {
                            label: linked ? t("salesInvoices.actionsMenu.unlinkReceipt") : t("salesInvoices.actionsMenu.linkReceipt"),
                            icon: linked ? Icon.Unlink : Icon.Link,
                            onClick: () => onLinkPaymentClick(row),
                            disabled: !posted && !linked,
                          },
                          { label: t("salesInvoices.actionsMenu.viewJournalEntry"), icon: Icon.BookOpen, onClick: () => onJournalClick(row), disabled: !posted || !row.journalEntryId },
                          {
                            label: row.customerEmail ? t("salesInvoices.actionsMenu.sendEmailTo", { email: row.customerEmail }) : t("salesInvoices.actionsMenu.sendEmailNoAddress"),
                            icon: Icon.Mail,
                            onClick: () => onSendEmailClick(row),
                            disabled: !posted || sendingEmailId === row.id,
                          },
                          {
                            label: t("salesInvoices.actionsMenu.reprintReceipt"),
                            icon: Icon.Receipt,
                            onClick: () => onReprintClick(row),
                            disabled: !posted,
                          },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 && <tr><td className="empty" colSpan={colSpan}>{t("salesInvoices.empty")}</td></tr>}
              {items.length > 0 && (
                <tr className="filtered-summary-row">
                  <td colSpan={2}>{t("salesInvoices.search.summary.count")}: {summary.count}</td>
                  <td>{t("salesInvoices.search.summary.netTotal")}: {money(summary.netTotal)}</td>
                  <td className="num">{t("salesInvoices.search.summary.vatTotal")}: {money(summary.vatTotal)}</td>
                  <td colSpan={4}>{t("salesInvoices.search.summary.grandTotal")}: {money(summary.grandTotal)}</td>
                </tr>
              )}
            </tbody>
          </table>

          <PaginationBar
            page={urlState.page}
            pageSize={urlState.pageSize}
            totalCount={result.totalCount}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageChange={(page) => setUrlState({ page })}
            onPageSizeChange={(pageSize) => setUrlState({ pageSize, page: 1 })}
          />
        </div>
      )}

      {formModal && (
        <InvoiceFormModal
          companyId={companyId}
          companies={companies}
          editingInvoice={formModal.mode === "edit" ? formModal.invoice : null}
          duplicateFrom={formModal.mode === "duplicate" ? formModal.invoice : null}
          onClose={() => setFormModal(null)}
          onSaved={onSaved}
        />
      )}

      {viewInvoice && (
        <InvoiceViewModal
          invoice={viewInvoice}
          companies={companies}
          autoPrint={autoPrint}
          onClose={() => { setViewInvoice(null); setAutoPrint(false); }}
          onChanged={reload}
        />
      )}

      {journalInvoice && (
        <JournalEntryViewModal journalEntryId={journalInvoice.journalEntryId} onClose={() => setJournalInvoice(null)} />
      )}

      {linkPaymentInvoice && (
        <LinkPaymentModal
          invoice={linkPaymentInvoice}
          companyId={companyId}
          onClose={() => setLinkPaymentInvoice(null)}
          onChanged={(message) => { reload(); notify(message); }}
        />
      )}

      {blockModal && (
        <PostedBlockModal
          invoiceId={blockModal.invoice.id}
          invoiceNumber={blockModal.invoice.invoiceNumber}
          action={blockModal.action}
          onClose={() => setBlockModal(null)}
          onUnposted={onUnpostedFromBlock}
        />
      )}

      {unpostTarget && <UnpostModal onCancel={() => setUnpostTarget(null)} onConfirm={doUnpost} />}

      {emailModalInvoice && (
        <SendInvoiceEmailModal
          invoice={emailModalInvoice}
          onClose={() => setEmailModalInvoice(null)}
          onSent={(message) => { setEmailModalInvoice(null); reload(); notify(message); }}
        />
      )}

      {reprintInvoice && (
        <ReprintReceiptModal
          invoice={reprintInvoice}
          company={companies?.find((c) => c.id === reprintInvoice.companyId) || reprintInvoice.company}
          onClose={() => setReprintInvoice(null)}
        />
      )}

      <ToastHost toast={toast} onDismiss={dismiss} />
    </div>
  );
}
