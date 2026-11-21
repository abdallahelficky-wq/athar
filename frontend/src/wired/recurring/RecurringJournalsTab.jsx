import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listAccounts } from "../../api/accounts";
import { listCostCenters } from "../../api/costCenters";
import {
  listRecurringJournals, getRecurringJournal, createRecurringJournal, updateRecurringJournal,
  setRecurringJournalActive, runRecurringJournalNow, deleteRecurringJournal,
} from "../../api/recurringJournals";
import { fmt2 } from "../../legacy/constants";
import FormDialog from "../shared/FormDialog";
import AccountSearchSelect from "../shared/AccountSearchSelect";

/**
 * القيود الدورية: قالب قيد متوازن يتكرر (شهري/ربع سنوي/نصف سنوي/سنوي) في يوم محدد، ينشئ منه الخادم قيداً عادياً في كل موعد
 * (مرحَّلاً أو مسودة). المنطق والجدولة في الخادم (recurringJournals.service.ts).
 */
const day = (iso) => (iso ? String(iso).slice(0, 10) : "—");
const today = () => new Date().toISOString().slice(0, 10);
const emptyLine = () => ({ accountId: "", costCenterId: "", description: "", debit: "", credit: "" });
const emptyForm = () => ({ name: "", memo: "", frequency: "monthly", dayOfMonth: 31, startDate: today(), endDate: "", autoPost: true, lines: [emptyLine(), emptyLine()] });
const num = (v) => Number(v || 0);

export default function RecurringJournalsTab({ companyId }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [editing, setEditing] = useState(null); // null | "new" | id
  const [form, setForm] = useState(emptyForm());
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    if (!companyId) return;
    listRecurringJournals(companyId).then(setRows).catch((e) => setError(e.message));
  }, [companyId]);
  useEffect(reload, [reload]);
  useEffect(() => {
    if (!companyId) return;
    listAccounts({ companyId, includePartyAccounts: false })
      .then((all) => setAccounts((all || []).filter((a) => a.isPosting && !a.isArchived && a.isActive !== false)))
      .catch(() => undefined);
    listCostCenters().then((all) => setCostCenters((all || []).filter((c) => !c.companyId || c.companyId === companyId))).catch(() => undefined);
  }, [companyId]);

  const openNew = () => { setForm(emptyForm()); setEditing("new"); setError(""); };
  const openEdit = (r) => {
    setForm({
      name: r.name, memo: r.memo || "", frequency: r.frequency, dayOfMonth: r.dayOfMonth,
      startDate: day(r.startDate), endDate: r.endDate ? day(r.endDate) : "", autoPost: r.autoPost,
      lines: r.lines.map((l) => ({ accountId: l.accountId, costCenterId: l.costCenterId || "", description: l.description || "", debit: Number(l.debit) || "", credit: Number(l.credit) || "" })),
    });
    setEditing(r.id); setError("");
  };
  const act = async (fn) => {
    setBusy(true); setError("");
    try { await fn(); reload(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const totalDr = form.lines.reduce((s, l) => s + num(l.debit), 0);
  const totalCr = form.lines.reduce((s, l) => s + num(l.credit), 0);
  const balanced = Math.round(totalDr * 100) === Math.round(totalCr * 100) && totalDr > 0;
  const setLine = (i, patch) => setForm((f) => ({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  const save = () => act(async () => {
    const payload = {
      companyId, name: form.name, memo: form.memo || null, frequency: form.frequency, dayOfMonth: Number(form.dayOfMonth),
      startDate: form.startDate, endDate: form.endDate || null, autoPost: form.autoPost,
      lines: form.lines.filter((l) => l.accountId).map((l) => ({ accountId: l.accountId, costCenterId: l.costCenterId || null, description: l.description || null, debit: num(l.debit), credit: num(l.credit) })),
    };
    if (editing === "new") await createRecurringJournal(payload);
    else await updateRecurringJournal(editing, payload);
    setEditing(null);
  });

  return (
    <div className="panel" data-testid="recurring-journals">
      <div className="modal-title-row">
        <h3 style={{ margin: 0 }}>{t("recurring.title")}</h3>
        <button className="btn-primary" onClick={openNew}>{t("recurring.add")}</button>
      </div>
      <p className="vat-note">{t("recurring.intro")}</p>
      {error && !editing && <p className="balance-bad">{error}</p>}
      <table className="ledger-table">
        <thead>
          <tr>
            <th>{t("recurring.name")}</th><th>{t("recurring.frequency")}</th><th>{t("recurring.amount")}</th>
            <th>{t("recurring.next")}</th><th>{t("recurring.mode")}</th><th>{t("recurring.status")}</th><th />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={7} className="vat-note">{t("recurring.empty")}</td></tr>}
          {rows.map((r) => {
            const amount = r.lines.reduce((s, l) => s + Number(l.debit), 0);
            return (
              <tr key={r.id}>
                <td>
                  <button type="button" className="btn-ghost" onClick={() => getRecurringJournal(r.id).then(setDetail).catch((e) => setError(e.message))}>{r.name}</button>
                  {r.lastError && <div className="balance-bad">{r.lastError}</div>}
                </td>
                <td>{t(`recurring.freq.${r.frequency}`)} · {r.dayOfMonth === 31 ? t("recurring.lastDay") : t("recurring.dayN", { n: r.dayOfMonth })}</td>
                <td className="num">{fmt2(amount)}</td>
                <td>{r.nextRunDate ? day(r.nextRunDate) : t("recurring.finished")}</td>
                <td>{r.autoPost ? t("recurring.autoPost") : t("recurring.draft")}</td>
                <td className={r.active ? "balance-ok" : "vat-note"}>{r.active ? t("recurring.active") : t("recurring.paused")}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button className="btn-ghost" disabled={busy} onClick={() => openEdit(r)}>{t("recurring.edit")}</button>
                  {r.active && r.nextRunDate && <button className="btn-ghost" disabled={busy} onClick={() => act(() => runRecurringJournalNow(r.id))}>{t("recurring.runNow")}</button>}
                  <button className="btn-ghost" disabled={busy} onClick={() => act(() => setRecurringJournalActive(r.id, !r.active))}>{r.active ? t("recurring.pause") : t("recurring.resume")}</button>
                  <button className="btn-ghost" disabled={busy} onClick={() => { if (window.confirm(t("recurring.deleteConfirm"))) act(() => deleteRecurringJournal(r.id)); }}>{t("recurring.delete")}</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <FormDialog open={Boolean(editing)} title={editing === "new" ? t("recurring.add") : t("recurring.edit")} onClose={() => setEditing(null)}>
        <div className="form-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
          <label>{t("recurring.name")}<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>{t("recurring.memo")}<input value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} /></label>
          <label>{t("recurring.frequency")}
            <select value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
              {["monthly", "quarterly", "semiannual", "yearly"].map((f) => <option key={f} value={f}>{t(`recurring.freq.${f}`)}</option>)}
            </select>
          </label>
          <label>{t("recurring.dueDay")}
            <select value={form.dayOfMonth} onChange={(e) => setForm({ ...form, dayOfMonth: Number(e.target.value) })}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
              <option value={31}>{t("recurring.lastDay")}</option>
            </select>
          </label>
          <label>{t("recurring.startDate")}<input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></label>
          <label>{t("recurring.endDate")}<input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></label>
          <label>{t("recurring.mode")}
            <select value={form.autoPost ? "post" : "draft"} onChange={(e) => setForm({ ...form, autoPost: e.target.value === "post" })}>
              <option value="post">{t("recurring.autoPost")}</option>
              <option value="draft">{t("recurring.draft")}</option>
            </select>
          </label>
        </div>
        <table className="ledger-table" style={{ marginTop: 12 }}>
          <thead><tr><th>{t("recurring.account")}</th><th>{t("recurring.costCenter")}</th><th>{t("recurring.lineDescription")}</th><th>{t("recurring.debit")}</th><th>{t("recurring.credit")}</th><th /></tr></thead>
          <tbody>
            {form.lines.map((l, i) => (
              <tr key={i}>
                <td style={{ minWidth: 220 }}><AccountSearchSelect accounts={accounts} value={l.accountId} onChange={(accountId) => setLine(i, { accountId })} /></td>
                <td>
                  <select value={l.costCenterId} onChange={(e) => setLine(i, { costCenterId: e.target.value })}>
                    <option value="">—</option>
                    {costCenters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </td>
                <td><input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} /></td>
                <td><input type="number" step="0.01" value={l.debit} onChange={(e) => setLine(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} /></td>
                <td><input type="number" step="0.01" value={l.credit} onChange={(e) => setLine(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} /></td>
                <td>{form.lines.length > 2 && <button type="button" className="btn-remove-line" onClick={() => setForm((f) => ({ ...f, lines: f.lines.filter((_, j) => j !== i) }))}>×</button>}</td>
              </tr>
            ))}
            <tr className="net-row">
              <td colSpan={3}><button type="button" className="btn-ghost" onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] }))}>{t("recurring.addLine")}</button></td>
              <td className="num strong">{fmt2(totalDr)}</td>
              <td className="num strong">{fmt2(totalCr)}</td>
              <td className={balanced ? "balance-ok" : "balance-bad"}>{balanced ? "✓" : t("recurring.unbalanced")}</td>
            </tr>
          </tbody>
        </table>
        {error && <p className="balance-bad">{error}</p>}
        <div style={{ marginTop: 12 }}>
          <button className="btn-primary" disabled={busy || !balanced || !form.name.trim()} onClick={save}>{t("recurring.save")}</button>
        </div>
      </FormDialog>

      <FormDialog open={Boolean(detail)} title={detail?.name || ""} onClose={() => setDetail(null)}>
        {detail && (
          <>
            <p className="vat-note">{t("recurring.runsNote")}</p>
            <table className="ledger-table">
              <thead><tr><th>{t("recurring.periodDate")}</th><th>{t("recurring.entry")}</th><th>{t("recurring.status")}</th></tr></thead>
              <tbody>
                {detail.runs.length === 0 && <tr><td colSpan={3} className="vat-note">{t("recurring.noRuns")}</td></tr>}
                {detail.runs.map((run) => (
                  <tr key={run.id}>
                    <td>{day(run.periodDate)}</td>
                    <td>{run.journalEntry ? run.journalEntry.entryNumber : t("recurring.entryDeleted")}</td>
                    <td>{run.journalEntry ? t(`recurring.entryStatus.${run.journalEntry.status}`) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </FormDialog>
    </div>
  );
}
