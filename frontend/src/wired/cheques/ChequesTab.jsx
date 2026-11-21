import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listAccounts } from "../../api/accounts";
import { listCustomers } from "../../api/customers";
import { listSuppliers } from "../../api/suppliers";
import { listCheques, createCheque, chequeAction, undoCheque, getChequeSettings, updateChequeSettings } from "../../api/cheques";
import { fmt2 } from "../../legacy/constants";
import FormDialog from "../shared/FormDialog";
import AccountSearchSelect from "../shared/AccountSearchSelect";

/**
 * الشيكات الواردة والصادرة: تسجيل ← تحصيل/صرف أو ارتداد/إلغاء، وكل حركة بقيدها. «تراجع» يلغي آخر حركة وقيدها
 * (والتراجع عن التسجيل يحذف الشيك). المنطق والقيود في الخادم (cheques.service.ts).
 */
const day = (iso) => (iso ? String(iso).slice(0, 10) : "—");
const today = () => new Date().toISOString().slice(0, 10);
const money = (v) => fmt2(Number(v || 0));
const emptyForm = (direction) => ({ direction, chequeNumber: "", bankName: "", issueDate: today(), dueDate: today(), amount: "", partyType: direction === "received" ? "customer" : "supplier", customerId: "", supplierId: "", counterAccountId: "", partyName: "", memo: "" });

export default function ChequesTab({ companyId }) {
  const { t } = useTranslation();
  const [direction, setDirection] = useState("received");
  const [status, setStatus] = useState("pending");
  const [rows, setRows] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState(null);
  const [action, setAction] = useState(null); // { cheque, type }
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    if (!companyId) return;
    listCheques({ companyId, direction, status }).then(setRows).catch((e) => setError(e.message));
  }, [companyId, direction, status]);
  useEffect(reload, [reload]);
  useEffect(() => {
    if (!companyId) return;
    getChequeSettings(companyId).then(setSettings).catch(() => undefined);
    listAccounts({ companyId, includePartyAccounts: false }).then((all) => setAccounts((all || []).filter((a) => a.isPosting && !a.isArchived))).catch(() => undefined);
    listCustomers(companyId).then((r) => setCustomers(Array.isArray(r) ? r : r?.items || [])).catch(() => undefined);
    listSuppliers(companyId).then((r) => setSuppliers(Array.isArray(r) ? r : r?.items || [])).catch(() => undefined);
  }, [companyId]);

  const run = async (fn) => {
    setBusy(true); setError("");
    try { await fn(); reload(); return true; } catch (e) { setError(e.message); return false; } finally { setBusy(false); }
  };
  const saveSetting = (key, value) => run(async () => setSettings(await updateChequeSettings({ companyId, [key]: value || null })));
  const middleMissing = settings && !(direction === "received" ? settings.chequesReceivableAccountId : settings.chequesPayableAccountId);
  const overdue = (r) => r.status === "pending" && day(r.dueDate) <= today();

  const submit = () => run(async () => {
    const f = form;
    await createCheque({
      companyId, direction: f.direction, chequeNumber: f.chequeNumber, bankName: f.bankName || null, issueDate: f.issueDate, dueDate: f.dueDate,
      amount: Number(f.amount), memo: f.memo || null, partyName: f.partyName || null,
      customerId: f.partyType === "customer" ? f.customerId || null : null,
      supplierId: f.partyType === "supplier" ? f.supplierId || null : null,
      counterAccountId: f.partyType === "other" ? f.counterAccountId || null : null,
    });
    setForm(null);
  });

  return (
    <div className="panel" data-testid="cheques">
      <div className="modal-title-row">
        <h3 style={{ margin: 0 }}>{t("cheques.title")}</h3>
        <button className="btn-primary" disabled={middleMissing} onClick={() => setForm(emptyForm(direction))}>{t(`cheques.add.${direction}`)}</button>
      </div>
      <p className="vat-note">{t("cheques.intro")}</p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
        <label>{t("cheques.direction")}
          <select value={direction} onChange={(e) => setDirection(e.target.value)}>
            <option value="received">{t("cheques.dir.received")}</option>
            <option value="issued">{t("cheques.dir.issued")}</option>
          </select>
        </label>
        <label>{t("cheques.status")}
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t("cheques.all")}</option>
            {["pending", "cleared", "bounced", "cancelled"].map((s) => <option key={s} value={s}>{t(`cheques.state.${direction}.${s}`)}</option>)}
          </select>
        </label>
        <label style={{ minWidth: 260 }}>{t(`cheques.middleAccount.${direction}`)}
          <AccountSearchSelect
            accounts={accounts.filter((a) => (direction === "received" ? a.type === "asset" && !a.isBankOrCash : a.type === "liability"))}
            value={(direction === "received" ? settings?.chequesReceivableAccountId : settings?.chequesPayableAccountId) || ""}
            onChange={(v) => saveSetting(direction === "received" ? "chequesReceivableAccountId" : "chequesPayableAccountId", v)}
          />
        </label>
      </div>
      {middleMissing && <p className="balance-bad">{t(`cheques.setupFirst.${direction}`)}</p>}
      {error && !form && !action && <p className="balance-bad">{error}</p>}
      <table className="ledger-table" style={{ marginTop: 12 }}>
        <thead><tr><th>{t("cheques.number")}</th><th>{t("cheques.party")}</th><th>{t("cheques.bank")}</th><th>{t("cheques.dueDate")}</th><th>{t("cheques.amount")}</th><th>{t("cheques.status")}</th><th /></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={7} className="vat-note">{t("cheques.empty")}</td></tr>}
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.chequeNumber}</td>
              <td>{r.customer?.name || r.supplier?.name || r.partyName || r.counterAccount?.name}</td>
              <td>{r.bankName || "—"}</td>
              <td className={overdue(r) ? "balance-bad strong" : undefined}>{day(r.dueDate)}{overdue(r) ? ` · ${t("cheques.due")}` : ""}</td>
              <td className="num">{money(r.amount)}</td>
              <td>{t(`cheques.state.${r.direction}.${r.status}`)}{r.bankAccount ? <div className="vat-note">{r.bankAccount.name}</div> : null}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                {r.status === "pending" && (
                  <>
                    <button className="btn-ghost" disabled={busy} onClick={() => setAction({ cheque: r, type: "clear", date: today(), bankAccountId: "", note: "" })}>{t(`cheques.action.clear.${r.direction}`)}</button>
                    <button className="btn-ghost" disabled={busy} onClick={() => setAction({ cheque: r, type: "bounce", date: today(), note: "" })}>{t("cheques.action.bounce")}</button>
                    <button className="btn-ghost" disabled={busy} onClick={() => setAction({ cheque: r, type: "cancel", date: today(), note: "" })}>{t("cheques.action.cancel")}</button>
                  </>
                )}
                <button className="btn-ghost" disabled={busy} onClick={() => { if (window.confirm(t("cheques.undoConfirm"))) run(() => undoCheque(r.id)); }}>{t("cheques.undo")}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <FormDialog open={Boolean(form)} title={form ? t(`cheques.add.${form.direction}`) : ""} onClose={() => setForm(null)}>
        {form && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
              <label>{t("cheques.number")}<input value={form.chequeNumber} onChange={(e) => setForm({ ...form, chequeNumber: e.target.value })} /></label>
              <label>{t("cheques.bank")}<input value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} /></label>
              <label>{t("cheques.amount")}<input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>
              <label>{t(`cheques.issueDate.${form.direction}`)}<input type="date" value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} /></label>
              <label>{t("cheques.dueDate")}<input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></label>
              <label>{t("cheques.partyType")}
                <select value={form.partyType} onChange={(e) => setForm({ ...form, partyType: e.target.value })}>
                  <option value="customer">{t("cheques.partyTypes.customer")}</option>
                  <option value="supplier">{t("cheques.partyTypes.supplier")}</option>
                  <option value="other">{t("cheques.partyTypes.other")}</option>
                </select>
              </label>
              {form.partyType === "customer" && (
                <label>{t("cheques.partyTypes.customer")}
                  <select value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
                    <option value="">—</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
              )}
              {form.partyType === "supplier" && (
                <label>{t("cheques.partyTypes.supplier")}
                  <select value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
                    <option value="">—</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
              )}
              {form.partyType === "other" && (
                <>
                  <label>{t("cheques.counterAccount")}<AccountSearchSelect accounts={accounts} value={form.counterAccountId} onChange={(v) => setForm({ ...form, counterAccountId: v })} /></label>
                  <label>{t("cheques.partyName")}<input value={form.partyName} onChange={(e) => setForm({ ...form, partyName: e.target.value })} /></label>
                </>
              )}
              <label>{t("cheques.memo")}<input value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} /></label>
            </div>
            <p className="vat-note">{t(`cheques.entryNote.registered.${form.direction}`)}</p>
            {error && <p className="balance-bad">{error}</p>}
            <button className="btn-primary" disabled={busy || !form.chequeNumber || !(Number(form.amount) > 0)} onClick={submit}>{t("cheques.save")}</button>
          </>
        )}
      </FormDialog>

      <FormDialog open={Boolean(action)} title={action ? `${t(action.type === "clear" ? `cheques.action.clear.${action.cheque.direction}` : `cheques.action.${action.type}`)} · ${action.cheque.chequeNumber}` : ""} onClose={() => setAction(null)}>
        {action && (
          <>
            <p className="vat-note">{t(`cheques.entryNote.${action.type}.${action.cheque.direction}`, { amount: money(action.cheque.amount) })}</p>
            <label>{t("cheques.date")}<input type="date" value={action.date} onChange={(e) => setAction({ ...action, date: e.target.value })} /></label>
            {action.type === "clear" && (
              <label>{t("cheques.bankAccount")}<AccountSearchSelect accounts={accounts.filter((a) => a.isBankOrCash)} value={action.bankAccountId} onChange={(v) => setAction({ ...action, bankAccountId: v })} /></label>
            )}
            <label>{t("cheques.note")}<input value={action.note} onChange={(e) => setAction({ ...action, note: e.target.value })} /></label>
            {error && <p className="balance-bad">{error}</p>}
            <div style={{ marginTop: 12 }}>
              <button className="btn-primary" disabled={busy || (action.type === "clear" && !action.bankAccountId)}
                onClick={async () => { if (await run(() => chequeAction(action.cheque.id, action.type, { date: action.date, bankAccountId: action.bankAccountId || null, note: action.note || null }))) setAction(null); }}>
                {t("cheques.confirm")}
              </button>
            </div>
          </>
        )}
      </FormDialog>
    </div>
  );
}
