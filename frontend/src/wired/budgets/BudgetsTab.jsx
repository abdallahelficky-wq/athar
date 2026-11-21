import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listAccounts } from "../../api/accounts";
import { listCostCenters } from "../../api/costCenters";
import { listBudgets, getBudget, createBudget, updateBudget, setBudgetStatus, deleteBudget, getBudgetReport, suggestBudget } from "../../api/budgets";
import { fmt2 } from "../../legacy/constants";
import FormDialog from "../shared/FormDialog";
import AccountSearchSelect from "../shared/AccountSearchSelect";

/**
 * الموازنات التقديرية: موازنة 12 شهراً لكل حساب (إيرادات ومصروفات غالباً)، تُعبَّأ يدوياً أو من فعلي سنة سابقة × نمو،
 * وتقرير الموازنة مقابل الفعلي حتى شهر مختار بالانحراف ونسبته وملاءمته. الحساب في الخادم (budgets.service.ts).
 */
const money = (v) => fmt2(Number(v || 0));
const thisYear = new Date().getFullYear();
const emptyForm = () => ({ name: "", startMonth: `${thisYear}-01`, costCenterId: "", notes: "", lines: [] });
const prevYearOf = (ym) => `${Number(ym.slice(0, 4)) - 1}${ym.slice(4)}`;

export default function BudgetsTab({ companyId }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [growth, setGrowth] = useState("0");
  const [report, setReport] = useState(null);
  const [through, setThrough] = useState("");
  const [monthly, setMonthly] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => { if (companyId) listBudgets(companyId).then(setRows).catch((e) => setError(e.message)); }, [companyId]);
  useEffect(reload, [reload]);
  useEffect(() => {
    if (!companyId) return;
    listAccounts({ companyId, includePartyAccounts: false }).then((all) => setAccounts((all || []).filter((a) => a.isPosting && !a.isArchived))).catch(() => undefined);
    listCostCenters().then((all) => setCostCenters((all || []).filter((c) => !c.companyId || c.companyId === companyId))).catch(() => undefined);
  }, [companyId]);

  const run = async (fn) => {
    setBusy(true); setError("");
    try { await fn(); return true; } catch (e) { setError(e.message); return false; } finally { setBusy(false); }
  };
  const openNew = () => { setForm(emptyForm()); setEditing("new"); setError(""); };
  const openEdit = (id) => run(async () => {
    const b = await getBudget(id);
    setForm({
      name: b.name, startMonth: String(b.startMonth).slice(0, 7), costCenterId: b.costCenterId || "", notes: b.notes || "",
      lines: b.lines.map((l) => ({ accountId: l.accountId, months: Array.from({ length: 12 }, (_, i) => Number(l[`m${String(i + 1).padStart(2, "0")}`]) || 0) })),
    });
    setEditing(id);
  });
  const openReport = (id, th) => run(async () => setReport(await getBudgetReport(id, th)));
  const fill = () => run(async () => {
    const suggested = await suggestBudget({ companyId, sourceStartMonth: prevYearOf(form.startMonth), growthPct: Number(growth), costCenterId: form.costCenterId || null });
    setForm((f) => ({ ...f, lines: suggested.map((s) => ({ accountId: s.accountId, months: s.months })) }));
  });
  const setCell = (li, mi, v) => setForm((f) => ({ ...f, lines: f.lines.map((l, j) => (j === li ? { ...l, months: l.months.map((x, k) => (k === mi ? v : x)) } : l)) }));
  const spread = (li, annual) => setForm((f) => ({ ...f, lines: f.lines.map((l, j) => (j === li ? { ...l, months: Array.from({ length: 12 }, (_, k) => (k < 11 ? Math.round((annual / 12) * 100) / 100 : Math.round((annual - Math.round((annual / 12) * 100) / 100 * 11) * 100) / 100)) } : l)) }));
  const save = () => run(async () => {
    const payload = { companyId, name: form.name, startMonth: form.startMonth, costCenterId: form.costCenterId || null, notes: form.notes || null, lines: form.lines.filter((l) => l.accountId).map((l) => ({ accountId: l.accountId, months: l.months.map((v) => Number(v) || 0) })) };
    if (editing === "new") await createBudget(payload); else await updateBudget(editing, payload);
    setEditing(null); reload();
  });
  const accountName = (id) => { const a = accounts.find((x) => x.id === id); return a ? `${a.code} — ${a.name}` : id; };

  if (report) {
    const r = report;
    return (
      <div className="panel" data-testid="budget-report">
        <div className="modal-title-row">
          <h3 style={{ margin: 0 }}>{t("budgets.reportTitle", { name: r.budget.name })}</h3>
          <button className="btn-secondary" onClick={() => setReport(null)}>{t("budgets.back")}</button>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
          <label>{t("budgets.through")}
            <select value={through || r.through} onChange={(e) => { setThrough(e.target.value); openReport(r.budget.id, e.target.value); }}>
              {r.months.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </label>
          <label><input type="checkbox" checked={monthly} onChange={(e) => setMonthly(e.target.checked)} /> {t("budgets.showMonthly")}</label>
          {r.budget.costCenter && <span className="vat-note">{t("budgets.costCenter")}: {r.budget.costCenter.name}</span>}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="ledger-table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>{t("budgets.account")}</th><th>{t("budgets.planYtd")}</th><th>{t("budgets.actualYtd")}</th><th>{t("budgets.variance")}</th><th>%</th><th>{t("budgets.planYear")}</th>
                {monthly && r.months.slice(0, r.through).map((m) => <th key={m}>{m}</th>)}
              </tr>
            </thead>
            <tbody>
              {r.lines.map((l) => (
                <tr key={l.accountId}>
                  <td>{l.code} — {l.name}</td>
                  <td className="num">{money(l.planYtd)}</td>
                  <td className="num">{money(l.actualYtd)}</td>
                  <td className={"num " + (l.favorable ? "balance-ok" : "balance-bad")}>{money(l.variance)}</td>
                  <td className={"num " + (l.favorable ? "balance-ok" : "balance-bad")}>{l.variancePct === null ? "—" : `${l.variancePct}%`}</td>
                  <td className="num">{money(l.planYear)}</td>
                  {monthly && l.plan.slice(0, r.through).map((p, i) => (
                    <td key={i} className="num" style={{ whiteSpace: "nowrap" }}>{money(l.actual[i])}<div className="vat-note">{money(p)}</div></td>
                  ))}
                </tr>
              ))}
              <tr className="net-row"><td className="strong">{t("budgets.totalRevenue")}</td><td className="num strong">{money(r.totals.revenue.planYtd)}</td><td className="num strong">{money(r.totals.revenue.actualYtd)}</td><td className="num strong">{money(r.totals.revenue.actualYtd - r.totals.revenue.planYtd)}</td><td /><td className="num strong">{money(r.totals.revenue.planYear)}</td></tr>
              <tr className="net-row"><td className="strong">{t("budgets.totalExpense")}</td><td className="num strong">{money(r.totals.expense.planYtd)}</td><td className="num strong">{money(r.totals.expense.actualYtd)}</td><td className="num strong">{money(r.totals.expense.actualYtd - r.totals.expense.planYtd)}</td><td /><td className="num strong">{money(r.totals.expense.planYear)}</td></tr>
              <tr className="net-row"><td className="strong">{t("budgets.net")}</td><td className="num strong">{money(r.totals.netPlanYtd)}</td><td className="num strong">{money(r.totals.netActualYtd)}</td><td className={"num strong " + (r.totals.netActualYtd >= r.totals.netPlanYtd ? "balance-ok" : "balance-bad")}>{money(r.totals.netActualYtd - r.totals.netPlanYtd)}</td><td /><td /></tr>
            </tbody>
          </table>
        </div>
        {monthly && <p className="vat-note">{t("budgets.monthlyNote")}</p>}
      </div>
    );
  }

  return (
    <div className="panel" data-testid="budgets">
      <div className="modal-title-row">
        <h3 style={{ margin: 0 }}>{t("budgets.title")}</h3>
        <button className="btn-primary" onClick={openNew}>{t("budgets.add")}</button>
      </div>
      <p className="vat-note">{t("budgets.intro")}</p>
      {error && !editing && <p className="balance-bad">{error}</p>}
      <table className="ledger-table">
        <thead><tr><th>{t("budgets.name")}</th><th>{t("budgets.startMonth")}</th><th>{t("budgets.costCenter")}</th><th>{t("budgets.lines")}</th><th>{t("budgets.status")}</th><th /></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={6} className="vat-note">{t("budgets.empty")}</td></tr>}
          {rows.map((b) => (
            <tr key={b.id}>
              <td><button type="button" className="btn-ghost" onClick={() => { setThrough(""); openReport(b.id); }}>{b.name}</button></td>
              <td>{String(b.startMonth).slice(0, 7)}</td>
              <td>{b.costCenter?.name || "—"}</td>
              <td className="num">{b._count?.lines ?? 0}</td>
              <td className={b.status === "approved" ? "balance-ok" : "vat-note"}>{t(`budgets.state.${b.status}`)}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                <button className="btn-ghost" disabled={busy} onClick={() => { setThrough(""); openReport(b.id); }}>{t("budgets.report")}</button>
                {b.status === "draft" && <button className="btn-ghost" disabled={busy} onClick={() => openEdit(b.id)}>{t("budgets.edit")}</button>}
                <button className="btn-ghost" disabled={busy} onClick={() => run(async () => { await setBudgetStatus(b.id, b.status === "draft" ? "approved" : "draft"); reload(); })}>{b.status === "draft" ? t("budgets.approve") : t("budgets.unapprove")}</button>
                {b.status === "draft" && <button className="btn-ghost" disabled={busy} onClick={() => { if (window.confirm(t("budgets.deleteConfirm"))) run(async () => { await deleteBudget(b.id); reload(); }); }}>{t("budgets.delete")}</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <FormDialog open={Boolean(editing)} title={editing === "new" ? t("budgets.add") : t("budgets.edit")} onClose={() => setEditing(null)} style={{ maxWidth: 1400 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <label>{t("budgets.name")}<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>{t("budgets.startMonth")}<input type="month" value={form.startMonth} onChange={(e) => setForm({ ...form, startMonth: e.target.value })} /></label>
          <label>{t("budgets.costCenter")}
            <select value={form.costCenterId} onChange={(e) => setForm({ ...form, costCenterId: e.target.value })}>
              <option value="">{t("budgets.allCostCenters")}</option>
              {costCenters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>{t("budgets.growth")}<input type="number" step="0.1" value={growth} onChange={(e) => setGrowth(e.target.value)} style={{ width: 90 }} /></label>
          <button className="btn-secondary" disabled={busy} onClick={fill}>{t("budgets.fillFromActuals", { from: prevYearOf(form.startMonth) })}</button>
        </div>
        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table className="ledger-table">
            <thead><tr><th>{t("budgets.account")}</th>{Array.from({ length: 12 }, (_, i) => <th key={i}>{i + 1}</th>)}<th>{t("budgets.planYear")}</th><th /></tr></thead>
            <tbody>
              {form.lines.map((l, li) => (
                <tr key={li}>
                  <td style={{ minWidth: 240 }}>{l.accountId ? accountName(l.accountId) : <AccountSearchSelect accounts={accounts.filter((a) => !form.lines.some((x) => x.accountId === a.id))} value="" onChange={(v) => setForm((f) => ({ ...f, lines: f.lines.map((x, j) => (j === li ? { ...x, accountId: v } : x)) }))} />}</td>
                  {l.months.map((v, mi) => <td key={mi}><input type="number" step="0.01" value={v} onChange={(e) => setCell(li, mi, e.target.value)} style={{ width: 90 }} /></td>)}
                  <td className="num">
                    <input type="number" step="0.01" title={t("budgets.spreadHint")} value={Math.round(l.months.reduce((s, v) => s + (Number(v) || 0), 0) * 100) / 100} onChange={(e) => spread(li, Number(e.target.value) || 0)} style={{ width: 110 }} />
                  </td>
                  <td><button type="button" className="btn-remove-line" onClick={() => setForm((f) => ({ ...f, lines: f.lines.filter((_, j) => j !== li) }))}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="btn-ghost" onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, { accountId: "", months: Array(12).fill(0) }] }))}>{t("budgets.addLine")}</button>
        <p className="vat-note">{t("budgets.spreadHint")}</p>
        {error && <p className="balance-bad">{error}</p>}
        <div style={{ marginTop: 12 }}><button className="btn-primary" disabled={busy || form.name.trim().length < 2} onClick={save}>{t("budgets.save")}</button></div>
      </FormDialog>
    </div>
  );
}
