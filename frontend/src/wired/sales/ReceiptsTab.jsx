import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listCustomers } from "../../api/customers";
import { listReceiptsPage, getOutstandingInvoices, createReceipt, unpostReceipt, postReceipt, deleteReceipt } from "../../api/receipts";
import { listAccounts } from "../../api/accounts";
import { fmt } from "../../legacy/constants";
import ReceiptViewModal from "./ReceiptViewModal";
import ActionsMenu from "../shared/ActionsMenu";
import UnpostModal from "../shared/UnpostModal";
import AttachmentsPanel from "../shared/AttachmentsPanel";
import PaginationBar from "../shared/PaginationBar";
import AccountSearchSelect from "../shared/AccountSearchSelect";
import { currencyLabel } from "../../shared/countries";
import { SalesScreen, SalesChip, SalesInfoChip, SalesKpis, StatusBadge } from "./SalesScreen";

export default function ReceiptsTab({ companyId, companies }) {
  const { t, i18n } = useTranslation();
  const currency = currencyLabel(companies?.find((c) => c.id === companyId)?.currency, i18n.language);
  const [customers, setCustomers] = useState([]);
  // صفحة من الخادم مع العدّادات وإجمالي المبالغ (parseListPage) بدل تحميل كل السندات
  const [result, setResult] = useState({ items: [], totalCount: 0, counts: { all: 0, posted: 0, draft: 0 }, totalAmount: 0 });
  const receipts = result.items;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [outstanding, setOutstanding] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [customerId, setCustomerId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("cash");
  const [bankAccountId, setBankAccountId] = useState("");
  const [allocations, setAllocations] = useState({});
  const [unpostTarget, setUnpostTarget] = useState(null);
  const [attachmentsFor, setAttachmentsFor] = useState(null);
  const [viewTarget, setViewTarget] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => {
    if (!companyId) return;
    listCustomers(companyId).then((cs) => { setCustomers(cs); if (cs[0]) setCustomerId((c) => c || cs[0].id); });
    listAccounts({ companyId }).then((accs) => {
      const banks = accs.filter((a) => a.isBankOrCash && a.name !== "النقدية بالصندوق");
      setBankAccounts(banks);
      setBankAccountId((id) => id || banks[0]?.id || "");
    });
  }, [companyId]);

  useEffect(() => {
    if (!customerId) { setOutstanding([]); return; }
    getOutstandingInvoices(customerId).then(setOutstanding);
    setAllocations({});
  }, [customerId]);

  const reload = () => {
    if (!companyId) return;
    setLoading(true);
    listReceiptsPage(companyId, { page, pageSize, status: statusFilter }).then(setResult).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(reload, [companyId, page, pageSize, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1); }, [companyId, statusFilter]);

  const totalAllocated = Object.values(allocations).reduce((s, v) => s + Number(v || 0), 0);
  const setAlloc = (invId, value) => setAllocations((prev) => ({ ...prev, [invId]: value }));

  const save = async () => {
    if (!customerId || totalAllocated <= 0) return;
    try {
      await createReceipt({
        companyId, customerId, date, method,
        bankAccountId: method === "bank" ? bankAccountId || null : null,
        allocations: Object.entries(allocations).filter(([, v]) => Number(v) > 0).map(([invoiceId, amount]) => ({ invoiceId, amount: Number(amount) })),
      });
      setAllocations({});
      getOutstandingInvoices(customerId).then(setOutstanding);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const doUnpost = async (pin) => {
    await unpostReceipt(unpostTarget.id, pin);
    setUnpostTarget(null);
    reload();
  };

  const changeReceipt = async (receipt, action) => {
    if (busyId) return;
    if (action === "delete" && !window.confirm(t("sales.receipts.confirmDelete", { number: receipt.receiptNumber }))) return;
    setBusyId(receipt.id);
    setError("");
    try {
      await (action === "delete" ? deleteReceipt(receipt.id) : postReceipt(receipt.id));
      reload();
      if (customerId) setOutstanding(await getOutstandingInvoices(customerId));
    } catch (err) { setError(err.message); }
    finally { setBusyId(null); }
  };

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  const shownReceipts = receipts;

  return (
    <SalesScreen
      icon="receipts"
      title={t("nav.tabs.receipts")}
      note={t("sales.screen.notes.receipts")}
      chips={<>
        <SalesChip on={!statusFilter} onClick={() => setStatusFilter("")}>{t("salesInvoices.screen.all")}</SalesChip>
        <SalesChip tone="ok" on={statusFilter === "posted"} onClick={() => setStatusFilter(statusFilter === "posted" ? "" : "posted")}>{t("sales.receipts.posted")}</SalesChip>
        <SalesChip tone="wait" on={statusFilter === "draft"} onClick={() => setStatusFilter(statusFilter === "draft" ? "" : "draft")}>{t("sales.receipts.draft")}</SalesChip>
        <SalesInfoChip count={loading ? "…" : result.totalCount} label={t("sales.screen.count")} />
      </>}
    >
      <SalesKpis loading={loading} items={[
        { label: t("sales.screen.count"), value: result.counts.all, tone: "gray" },
        { label: t("sales.screen.total"), value: `${fmt(result.totalAmount || 0)} ${currency}`, tone: "green" },
        { label: t("sales.receipts.posted"), value: result.counts.posted, tone: "teal" },
        { label: t("sales.receipts.draft"), value: result.counts.draft, tone: "amber" },
      ]} />
      <div className="panel form-panel">
        <div className="form-grid header-grid">
          <label>{t("sales.receipts.customer")}<select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>{t("sales.receipts.date")}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label>{t("sales.receipts.method")}<select value={method} onChange={(e) => setMethod(e.target.value)}><option value="cash">{t("sales.receipts.methodCash")}</option><option value="bank">{t("sales.receipts.methodBank")}</option></select></label>
          {method === "bank" && (
            <label>{t("sales.receipts.bankAccount")}
              <AccountSearchSelect
                accounts={bankAccounts}
                value={bankAccountId}
                onChange={setBankAccountId}
                placeholder={bankAccounts.length === 0 ? t("sales.receipts.noBankAccounts") : t("sales.receipts.bankAccountPlaceholder")}
              />
            </label>
          )}
        </div>

        <h3 className="sub-head">{t("sales.receipts.outstandingTitle")}</h3>
        <div className="lines-table-wrap">
          <table className="lines-table">
            <thead>
              <tr>
                <th>{t("sales.receipts.table.invoice")}</th><th>{t("sales.receipts.table.total")}</th>
                <th>{t("sales.receipts.table.paid")}</th><th>{t("sales.receipts.table.remaining")}</th>
                <th>{t("sales.receipts.table.allocated")}</th>
              </tr>
            </thead>
            <tbody>
              {outstanding.map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.invoiceNumber}</td>
                  <td className="num">{fmt(inv.grandTotal)}</td>
                  <td className="num">{fmt(inv.paid)}</td>
                  <td className="num strong">{fmt(inv.due)}</td>
                  <td><input type="number" className="amount-input" value={allocations[inv.id] || ""} onChange={(e) => setAlloc(inv.id, e.target.value)} placeholder="0.00" /></td>
                </tr>
              ))}
              {outstanding.length === 0 && <tr><td className="empty" colSpan={5}>{t("sales.receipts.noOutstanding")}</td></tr>}
            </tbody>
          </table>
        </div>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          <button className="btn-primary" onClick={save} disabled={totalAllocated <= 0}>{t("sales.receipts.saveAndPost", { amount: fmt(totalAllocated), currency })}</button>
        </div>
      </div>

      {loading ? <div className="panel"><p className="empty">{t("sales.receipts.loading")}</p></div> : (
        <div className="panel ss-table">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>{t("sales.receipts.listTable.number")}</th><th>{t("sales.receipts.listTable.customer")}</th>
                <th>{t("sales.receipts.listTable.date")}</th><th>{t("sales.receipts.listTable.method")}</th>
                <th>{t("sales.receipts.listTable.total")}</th><th>{t("sales.receipts.listTable.status")}</th><th>{t("sales.receipts.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {shownReceipts.map((r) => (
                <React.Fragment key={r.id}>
                  <tr>
                    <td>{r.receiptNumber}</td><td>{r.customer?.name}</td><td>{r.date.slice(0, 10)}</td>
                    <td>{r.method === "cash" ? t("sales.receipts.methodCash") : `${t("sales.receipts.methodBank")}${r.bankAccount ? ` (${r.bankAccount.name})` : ""}`}</td>
                    <td className="num">{fmt(r.totalAmount)}</td>
                    <td><StatusBadge tone={r.status === "posted" ? "ok" : "wait"}>{r.status === "posted" ? t("sales.receipts.posted") : t("sales.receipts.draft")}</StatusBadge></td>
                    <td className="row-actions">
                      <button className="btn-ghost" onClick={() => setViewTarget({ receipt: r, autoPrint: false })}>{t("sales.receipts.view")}</button>
                      <button className="btn-ghost" onClick={() => setViewTarget({ receipt: r, autoPrint: true })}>{t("common.print")}</button>
                      <ActionsMenu title={t("sales.receipts.actions")} items={[
                        { label: t("sales.receipts.post"), hidden: r.status === "posted", disabled: busyId === r.id, onClick: () => changeReceipt(r, "post") },
                        { label: t("sales.receipts.unpost"), hidden: r.status !== "posted", onClick: () => setUnpostTarget(r) },
                        { label: t("sales.receipts.delete"), hidden: r.status === "posted", danger: true, disabled: busyId === r.id, onClick: () => changeReceipt(r, "delete") },
                        { label: attachmentsFor === r.id ? t("sales.receipts.attachmentsHide") : t("sales.receipts.attachmentsShow"), onClick: () => setAttachmentsFor(attachmentsFor === r.id ? null : r.id) },
                      ]} />
                    </td>
                  </tr>
                  {attachmentsFor === r.id && (
                    <tr><td colSpan={7}><AttachmentsPanel entityType="receipt" entityId={r.id} /></td></tr>
                  )}
                </React.Fragment>
              ))}
              {receipts.length === 0 && <tr><td className="empty" colSpan={7}>{t("sales.receipts.empty")}</td></tr>}
            </tbody>
          </table>
          <PaginationBar page={page} pageSize={pageSize} totalCount={result.totalCount} pageSizeOptions={[15, 25, 50, 100]} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />
        </div>
      )}

      {viewTarget && viewTarget.receipt.companyId === companyId && <ReceiptViewModal receipt={viewTarget.receipt} company={companies?.find(c => c.id === companyId)} autoPrint={viewTarget.autoPrint} onClose={() => setViewTarget(null)} />}
      {unpostTarget && <UnpostModal onCancel={() => setUnpostTarget(null)} onConfirm={doUnpost} />}
    </SalesScreen>
  );
}
