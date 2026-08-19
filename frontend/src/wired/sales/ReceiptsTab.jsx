import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listCustomers } from "../../api/customers";
import { listReceipts, getOutstandingInvoices, createReceipt, unpostReceipt } from "../../api/receipts";
import { listAccounts } from "../../api/accounts";
import { fmt } from "../../legacy/constants";
import UnpostModal from "../shared/UnpostModal";
import AttachmentsPanel from "../shared/AttachmentsPanel";
import AccountSearchSelect from "../shared/AccountSearchSelect";

export default function ReceiptsTab({ companyId }) {
  const { t } = useTranslation();
  const [customers, setCustomers] = useState([]);
  const [receipts, setReceipts] = useState([]);
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
    listReceipts(companyId).then(setReceipts).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(reload, [companyId]);

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

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  return (
    <div>
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
          <button className="btn-primary" onClick={save} disabled={totalAllocated <= 0}>{t("sales.receipts.saveAndPost", { amount: fmt(totalAllocated) })}</button>
        </div>
      </div>

      {loading ? <p className="empty">{t("sales.receipts.loading")}</p> : (
        <div className="panel">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>{t("sales.receipts.listTable.number")}</th><th>{t("sales.receipts.listTable.customer")}</th>
                <th>{t("sales.receipts.listTable.date")}</th><th>{t("sales.receipts.listTable.method")}</th>
                <th>{t("sales.receipts.listTable.total")}</th><th>{t("sales.receipts.listTable.status")}</th><th></th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <React.Fragment key={r.id}>
                  <tr>
                    <td>{r.receiptNumber}</td><td>{r.customer?.name}</td><td>{r.date.slice(0, 10)}</td>
                    <td>{r.method === "cash" ? t("sales.receipts.methodCash") : `${t("sales.receipts.methodBank")}${r.bankAccount ? ` (${r.bankAccount.name})` : ""}`}</td>
                    <td className="num">{fmt(r.totalAmount)}</td>
                    <td><span className="status-badge">{r.status === "posted" ? t("sales.receipts.posted") : t("sales.receipts.draft")}</span></td>
                    <td className="row-actions">
                      {r.status === "posted" && <button className="btn-ghost" onClick={() => setUnpostTarget(r)}>{t("sales.receipts.unpost")}</button>}
                      <button className="btn-ghost" onClick={() => setAttachmentsFor(attachmentsFor === r.id ? null : r.id)}>
                        {attachmentsFor === r.id ? t("sales.receipts.attachmentsHide") : t("sales.receipts.attachmentsShow")}
                      </button>
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
        </div>
      )}

      {unpostTarget && <UnpostModal onCancel={() => setUnpostTarget(null)} onConfirm={doUnpost} />}
    </div>
  );
}
