import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { searchSalesReturns, getSalesReturn, deleteSalesReturn, unpostSalesReturn, retrySalesReturn, completeSalesReturn } from "../../api/salesReturns";
import { fmt } from "../../legacy/constants";
import { currencyLabel } from "../../shared/countries";
import { currentFiscalYearStartDateOnly, todayDateOnly } from "../../shared/fiscalYear";
import { routes } from "../../routes";
import { Icon } from "../../legacy/shared";
import { useToast, ToastHost } from "../shared/Toast";
import UnpostModal from "../shared/UnpostModal";
import AttachmentsPanel from "../shared/AttachmentsPanel";
import FilterBar from "../shared/FilterBar";
import PaginationBar from "../shared/PaginationBar";
import SortableTh from "../shared/SortableTh";
import CustomerPicker from "../shared/CustomerPicker";
import { useUrlQueryState } from "../shared/useUrlQueryState";
import { useDebouncedValue } from "../shared/useDebouncedValue";
import InvoicePicker from "./InvoicePicker";
import SalesReturnFormModal from "./SalesReturnFormModal";
import SalesReturnViewModal from "./SalesReturnViewModal";
import ReturnPostedBlockModal from "./ReturnPostedBlockModal";

const PAGE_SIZE_OPTIONS = [15, 25, 50, 100, 200];
const SUBTYPE_OPTIONS = ["standard", "simplified"];
const REFUND_METHOD_OPTIONS = ["account", "cash", "bank"];
const POSTING_STATUS_OPTIONS = ["draft", "posted", "pending_submission", "zatca_accepted_posting_incomplete"];
const ZATCA_STATUS_OPTIONS = ["sent", "sent_with_notes", "not_sent", "not_applicable"];

const FILTER_DEFAULTS = {
  q: "", dateFrom: "", dateTo: "", amountMin: "", amountMax: "", customerId: "", originalInvoiceId: "",
  subtype: "", refundMethod: "", status: "", zatcaStatus: "",
  sortBy: "date", sortDir: "desc", page: 1, pageSize: 25,
};
const DRAFT_KEYS = ["dateFrom", "dateTo", "amountMin", "amountMax", "customerId", "originalInvoiceId", "subtype", "refundMethod", "status", "zatcaStatus"];
const EMPTY_SUMMARY = { count: 0, netTotal: "0", vatTotal: "0", grandTotal: "0" };

// نفس تبرير postingStatusLabel في InvoicesTab.jsx بالضبط — أربع حالات ترحيل ممكنة، لا اثنتين.
function postingStatusLabel(status, t) {
  if (status === "posted") return t("sales.returns.posted");
  if (status === "pending_submission") return t("sales.returns.pendingSubmission");
  if (status === "zatca_accepted_posting_incomplete") return t("sales.returns.postingIncomplete");
  return t("sales.returns.draft");
}

function zatcaGroupClassName(group) {
  return `status-badge ${group === "sent" ? "status-posted" : group === "not_applicable" ? "status-neutral" : "status-warning"}`;
}

export default function ReturnsTab({ companyId, companies }) {
  const { t, i18n } = useTranslation();
  const currency = currencyLabel(companies?.find((c) => c.id === companyId)?.currency, i18n.language);
  const [searchParams, setSearchParams] = useSearchParams();
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
  const [viewReturn, setViewReturn] = useState(null);
  const [autoPrint, setAutoPrint] = useState(false);
  const [blockModal, setBlockModal] = useState(null);
  const [unpostTarget, setUnpostTarget] = useState(null);
  const [attachmentsFor, setAttachmentsFor] = useState(null);
  const [resumingId, setResumingId] = useState(null);

  const reload = () => setReloadTick((n) => n + 1);

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    searchSalesReturns(companyId, urlState)
      .then(setResult)
      .catch((e) => notify(e.message, "error"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, JSON.stringify(urlState), reloadTick]);

  // يُبقي تدفّق "↩ إرجاع الفاتورة" من InvoiceCreditNotes.jsx يعمل تماماً كما كان: يفتح نافذة
  // الإنشاء مُعبَّأة مسبقاً بفاتورة محدَّدة، لا فلترة القائمة بها — راجع SalesReturnFormModal.jsx.
  useEffect(() => {
    const invoiceId = searchParams.get("invoiceId");
    if (invoiceId) {
      setFormModal({ mode: "create", prefillInvoiceId: invoiceId });
      setSearchParams((prev) => { const next = new URLSearchParams(prev); next.delete("invoiceId"); return next; }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  const money = (n) => `${fmt(Number(n))} ${currency}`;

  const applyDraft = () => setUrlState({ ...draft, page: 1 });
  const resetFilters = () => {
    setDraft(Object.fromEntries(DRAFT_KEYS.map((k) => [k, FILTER_DEFAULTS[k]])));
    setQInput("");
    setUrlState({ ...FILTER_DEFAULTS });
  };

  const onSort = (sortBy, sortDir) => setUrlState({ sortBy, sortDir, page: 1 });

  const withFullReturn = async (id, then) => {
    try {
      const full = await getSalesReturn(id);
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

  const onViewClick = (row) => withFullReturn(row.id, setViewReturn);
  const onPrintClick = (row) => withFullReturn(row.id, (full) => { setViewReturn(full); setAutoPrint(true); });

  const onEditClick = (row) => {
    if (row.status === "posted") { setBlockModal({ id: row.id, number: row.returnNumber, action: t("sales.returns.blockAction.edit") }); return; }
    withFullReturn(row.id, (full) => setFormModal({ mode: "edit", editingReturn: full }));
  };

  const onDeleteClick = async (row) => {
    if (row.status !== "draft") { notify(t("sales.returns.notify.deleteNonDraft"), "error"); return; }
    if (!window.confirm(t("sales.returns.notify.confirmDelete", { number: row.returnNumber }))) return;
    try {
      await deleteSalesReturn(row.id);
      reload();
      notify(t("sales.returns.notify.deleted", { number: row.returnNumber }));
    } catch (err) {
      notify(err.message, "error");
    }
  };

  const doUnpost = async (pin) => {
    await unpostSalesReturn(unpostTarget.id, pin);
    const number = unpostTarget.returnNumber;
    setUnpostTarget(null);
    reload();
    notify(t("sales.returns.notify.unposted", { number }));
  };

  const onUnpostedFromBlock = () => {
    setBlockModal(null);
    reload();
    notify(t("sales.returns.notify.unpostedFromBlock", { number: blockModal.number }));
  };

  const resumeReturn = async (row) => {
    if (resumingId) return;
    setResumingId(row.id);
    try {
      const updated = await (row.status === "pending_submission" ? retrySalesReturn(row.id) : completeSalesReturn(row.id));
      reload();
      const baseMessage = t(updated.status === "posted" ? "creditNote.saved" : "creditNote.savedPending", { number: updated.returnNumber });
      notify(updated.rejectionReason ? `${baseMessage} — ${updated.rejectionReason}` : baseMessage, updated.rejectionReason ? "error" : "success");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setResumingId(null);
    }
  };

  const colSpan = 8;
  const items = result.items;
  const summary = result.summary || EMPTY_SUMMARY;

  return (
    <div>
      <div className="form-btn-group" style={{ justifyContent: "flex-start", marginBottom: 14 }}>
        <button className="btn-primary" onClick={() => setFormModal({ mode: "create" })}>{t("sales.returns.addButton")}</button>
      </div>

      <FilterBar onSearch={applyDraft} onReset={resetFilters}>
        <label>
          {t("sales.returns.search.quickSearchLabel")}
          <input type="text" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder={t("sales.returns.search.quickSearchPlaceholder")} />
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
          {t("sales.returns.originalInvoice")}
          <InvoicePicker companyId={companyId} value={draft.originalInvoiceId} onChange={(id) => setDraft((d) => ({ ...d, originalInvoiceId: id }))} />
        </label>
        <label>
          {t("sales.returns.search.subtypeLabel")}
          <select value={draft.subtype} onChange={(e) => setDraft((d) => ({ ...d, subtype: e.target.value }))}>
            <option value="">{t("sales.returns.search.subtypeAll")}</option>
            {SUBTYPE_OPTIONS.map((v) => (
              <option key={v} value={v}>{t(`salesInvoices.search.invoiceType${v === "standard" ? "Standard" : "Simplified"}`)}</option>
            ))}
          </select>
        </label>
        <label>
          {t("sales.returns.search.refundMethodLabel")}
          <select value={draft.refundMethod} onChange={(e) => setDraft((d) => ({ ...d, refundMethod: e.target.value }))}>
            <option value="">{t("sales.returns.search.refundMethodAll")}</option>
            {REFUND_METHOD_OPTIONS.map((v) => (
              <option key={v} value={v}>{t(`sales.returns.refund${v === "cash" ? "Cash" : v === "bank" ? "Bank" : "Account"}`)}</option>
            ))}
          </select>
        </label>
        <label>
          {t("sales.returns.search.postingStatusLabel")}
          <select value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}>
            <option value="">{t("sales.returns.search.postingStatusAll")}</option>
            {POSTING_STATUS_OPTIONS.map((v) => (
              <option key={v} value={v}>{postingStatusLabel(v, t)}</option>
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

      {loading ? <p className="empty">{t("sales.returns.loading")}</p> : (
        <div className="panel">
          <table className="ledger-table responsive-table">
            <thead>
              <tr>
                <SortableTh label={t("sales.returns.table.number")} sortKey="returnNumber" sort={urlState} onSort={onSort} />
                <SortableTh label={t("sales.returns.table.customer")} sortKey="customerName" sort={urlState} onSort={onSort} />
                <th>{t("sales.returns.table.originalInvoice")}</th>
                <SortableTh label={t("sales.returns.table.date")} sortKey="date" sort={urlState} onSort={onSort} />
                <SortableTh label={t("sales.returns.table.total")} sortKey="grandTotal" sort={urlState} onSort={onSort} className="num" />
                <th>{t("sales.returns.table.postingStatus")}</th>
                <th>{t("sales.returns.table.zatcaStatus")}</th>
                <th>{t("sales.returns.table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const posted = row.status === "posted";
                const isDraft = row.status === "draft";
                return (
                  <React.Fragment key={row.id}>
                    <tr>
                      <td data-label={t("sales.returns.table.number")}>{row.returnNumber}</td>
                      <td data-label={t("sales.returns.table.customer")}>
                        <Link
                          className="drill-link"
                          to={routes.customerStatement(row.customerId, row.companyId, currentFiscalYearStartDateOnly(), todayDateOnly())}
                        >
                          {row.customerName}
                        </Link>
                      </td>
                      <td data-label={t("sales.returns.table.originalInvoice")}>
                        {row.relatedInvoiceNumber ? (
                          <Link className="drill-link" to={routes.invoiceByNumber(row.relatedInvoiceNumber)}>{row.relatedInvoiceNumber}</Link>
                        ) : t("sales.returns.noLink")}
                      </td>
                      <td data-label={t("sales.returns.table.date")}>{row.date.slice(0, 10)}</td>
                      <td className="num" data-label={t("sales.returns.table.total")}>{fmt(Number(row.grandTotal))}</td>
                      <td data-label={t("sales.returns.table.postingStatus")}><span className="status-badge">{postingStatusLabel(row.status, t)}</span></td>
                      <td data-label={t("sales.returns.table.zatcaStatus")}>
                        <button type="button" className={zatcaGroupClassName(row.zatcaGroup)} onClick={() => onViewClick(row)}>
                          {t(`salesInvoices.zatcaSummary.${row.zatcaGroup}`)}
                        </button>
                        {["pending_submission", "zatca_accepted_posting_incomplete"].includes(row.status) && (
                          <button type="button" className="btn-secondary" disabled={!!resumingId} onClick={() => resumeReturn(row)}>
                            {t(resumingId === row.id ? "salesInvoices.zatcaSummary.sending" : row.status === "pending_submission" ? "salesInvoices.zatcaSummary.resend" : "creditNote.complete")}
                          </button>
                        )}
                      </td>
                      <td className="row-actions">
                        <button className="icon-btn" title={t("sales.returns.actionsMenu.view")} onClick={() => onViewClick(row)}><Icon.Eye /></button>
                        <button className="icon-btn" title={t("sales.returns.actionsMenu.edit")} onClick={() => onEditClick(row)}><Icon.Edit /></button>
                        {posted && <button className="icon-btn icon-btn-warn" title={t("sales.returns.unpost")} onClick={() => setUnpostTarget(row)}><Icon.Unlock /></button>}
                        {isDraft && <button className="icon-btn icon-btn-danger" title={t("sales.returns.actionsMenu.delete")} onClick={() => onDeleteClick(row)}><Icon.Trash /></button>}
                        <button className="icon-btn" title={t("sales.returns.actionsMenu.print")} onClick={() => onPrintClick(row)}><Icon.Printer /></button>
                        <button className="icon-btn" title={attachmentsFor === row.id ? t("sales.returns.attachmentsHide") : t("sales.returns.attachmentsShow")} onClick={() => setAttachmentsFor(attachmentsFor === row.id ? null : row.id)}>
                          <Icon.BookOpen />
                        </button>
                      </td>
                    </tr>
                    {attachmentsFor === row.id && (
                      <tr><td colSpan={colSpan}><AttachmentsPanel entityType="sales_return" entityId={row.id} /></td></tr>
                    )}
                  </React.Fragment>
                );
              })}
              {items.length === 0 && <tr><td className="empty" colSpan={colSpan}>{t("sales.returns.empty")}</td></tr>}
              {items.length > 0 && (
                <tr className="filtered-summary-row">
                  <td colSpan={2}>{t("sales.returns.search.summary.count")}: {summary.count}</td>
                  <td>{t("sales.returns.search.summary.netTotal")}: {money(summary.netTotal)}</td>
                  <td className="num">{t("sales.returns.search.summary.vatTotal")}: {money(summary.vatTotal)}</td>
                  <td colSpan={4}>{t("sales.returns.search.summary.grandTotal")}: {money(summary.grandTotal)}</td>
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
        <SalesReturnFormModal
          companyId={companyId}
          companies={companies}
          editingReturn={formModal.mode === "edit" ? formModal.editingReturn : null}
          prefillInvoiceId={formModal.mode === "create" ? formModal.prefillInvoiceId : undefined}
          onClose={() => setFormModal(null)}
          onSaved={onSaved}
        />
      )}

      {viewReturn && (
        <SalesReturnViewModal
          salesReturn={viewReturn}
          companies={companies}
          autoPrint={autoPrint}
          onClose={() => { setViewReturn(null); setAutoPrint(false); }}
          onChanged={reload}
        />
      )}

      {blockModal && (
        <ReturnPostedBlockModal
          returnId={blockModal.id}
          returnNumber={blockModal.number}
          action={blockModal.action}
          onClose={() => setBlockModal(null)}
          onUnposted={onUnpostedFromBlock}
        />
      )}

      {unpostTarget && <UnpostModal onCancel={() => setUnpostTarget(null)} onConfirm={doUnpost} />}

      <ToastHost toast={toast} onDismiss={dismiss} />
    </div>
  );
}
