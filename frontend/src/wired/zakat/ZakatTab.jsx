import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listAccounts } from "../../api/accounts";
import {
  computeZakat, updateZakatSettings, setZakatTreatment, listZakatDeclarations, saveZakatDeclaration,
  postZakatDeclaration, deleteZakatDeclaration,
} from "../../api/zakat";
import { fmt2 } from "../../legacy/constants";
import FormDialog from "../shared/FormDialog";
import AccountSearchSelect from "../shared/AccountSearchSelect";

/**
 * الزكاة: الوعاء الزكوي من الدفاتر (قيود مرحَّلة) وفق اللائحة التنفيذية 1445هـ أو صافي الأصول المتداولة — حسب إعداد الشركة.
 * كل بند قابل للمراجعة: تصنيف كل حساب ذي رصيد، وتسويات صافي الربح اليدوية. الحساب والتحقق في الخادم (zakat.service.ts).
 */
const TREATMENTS_BY_TYPE = {
  asset: ["deductible_non_current_asset", "non_deductible_non_current_asset", "deductible_current_asset", "current_asset", "excluded"],
  liability: ["non_current_liability", "current_liability", "equity", "excluded"],
  equity: ["equity", "excluded"],
};
const money = (v) => fmt2(Number(v || 0));
const day = (iso) => (iso ? String(iso).slice(0, 10) : "—");
const lastYear = new Date().getFullYear() - 1;

export default function ZakatTab({ companyId, companies }) {
  const { t } = useTranslation();
  const company = (companies || []).find((c) => c.id === companyId);
  const [period, setPeriod] = useState({ periodStart: `${lastYear}-01-01`, periodEnd: `${lastYear}-12-31`, hijriYear: false });
  const [method, setMethod] = useState(company?.zakatMethod || "regulation_1445");
  const [ownership, setOwnership] = useState(company?.zakatableOwnershipPct !== undefined ? String(Number(company.zakatableOwnershipPct)) : "100");
  const [adjustments, setAdjustments] = useState([]);
  const [data, setData] = useState(null);
  const [declarations, setDeclarations] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [posting, setPosting] = useState(null);

  useEffect(() => {
    setMethod(company?.zakatMethod || "regulation_1445");
    setOwnership(company?.zakatableOwnershipPct !== undefined ? String(Number(company.zakatableOwnershipPct)) : "100");
  }, [company?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const validAdjustments = adjustments.filter((a) => a.label.trim() && Number(a.amount));
  const params = { companyId, ...period, method, zakatableOwnershipPct: ownership, adjustments: validAdjustments.map((a) => ({ label: a.label, amount: Number(a.amount) })) };

  const loadDeclarations = useCallback(() => { if (companyId) listZakatDeclarations(companyId).then(setDeclarations).catch(() => undefined); }, [companyId]);
  useEffect(loadDeclarations, [loadDeclarations]);

  const run = async (fn) => {
    setBusy(true); setError("");
    try { return await fn(); } catch (e) { setError(e.message); return null; } finally { setBusy(false); }
  };
  const compute = () => run(async () => setData(await computeZakat(params)));
  const saveSettings = () => run(() => updateZakatSettings({ companyId, zakatMethod: method, zakatableOwnershipPct: Number(ownership) }));
  const changeTreatment = (accountId, treatment) => run(async () => { await setZakatTreatment(accountId, treatment || null); setData(await computeZakat(params)); });
  const save = () => run(async () => { await saveZakatDeclaration(params); loadDeclarations(); });

  const r = data?.result;
  const i = data?.inputs;
  const rows = data && (data.method === "regulation_1445"
    ? [
        ["equity", i.equity], ["profitDifference", r.profitDifference], ["nonCurrentLiabilitiesAdded", r.nonCurrentLiabilitiesAdded],
        ["currentLiabilitiesAdded", r.currentLiabilitiesAdded], ["deductions", -r.totalDeductions], ["baseBeforeLimits", r.baseBeforeLimits, true],
        ["maxBase", r.maxBase], ["adjustedNetProfit", r.adjustedNetProfit],
      ]
    : [
        ["currentAssets", i.deductibleCurrentAssets + i.nonDeductibleCurrentAssets], ["currentLiabilities", -i.currentLiabilities],
        ["profitDifference", r.profitDifference], ["baseBeforeLimits", r.baseBeforeLimits, true],
      ]);

  return (
    <div data-testid="zakat-tab">
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>{t("zakat.title")}</h3>
        <p className="vat-note">{t("zakat.intro")}</p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
          <label>{t("zakat.method")}
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="regulation_1445">{t("zakat.methods.regulation_1445")}</option>
              <option value="net_current_assets">{t("zakat.methods.net_current_assets")}</option>
            </select>
          </label>
          <label>{t("zakat.ownership")}<input type="number" min="0" max="100" step="0.01" value={ownership} onChange={(e) => setOwnership(e.target.value)} style={{ width: 90 }} /></label>
          <button className="btn-ghost" disabled={busy} onClick={saveSettings}>{t("zakat.saveSettings")}</button>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end", marginTop: 10 }}>
          <label>{t("zakat.from")}<input type="date" value={period.periodStart} onChange={(e) => setPeriod({ ...period, periodStart: e.target.value })} /></label>
          <label>{t("zakat.to")}<input type="date" value={period.periodEnd} onChange={(e) => setPeriod({ ...period, periodEnd: e.target.value })} /></label>
          <label><input type="checkbox" checked={period.hijriYear} onChange={(e) => setPeriod({ ...period, hijriYear: e.target.checked })} /> {t("zakat.hijriYear")}</label>
        </div>
        <h4>{t("zakat.adjustments")}</h4>
        <p className="vat-note">{t("zakat.adjustmentsNote")}</p>
        {adjustments.map((a, idx) => (
          <div key={idx} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            <input placeholder={t("zakat.adjustmentLabel")} value={a.label} onChange={(e) => setAdjustments(adjustments.map((x, j) => (j === idx ? { ...x, label: e.target.value } : x)))} style={{ flex: 1 }} />
            <input type="number" step="0.01" value={a.amount} onChange={(e) => setAdjustments(adjustments.map((x, j) => (j === idx ? { ...x, amount: e.target.value } : x)))} style={{ width: 160 }} />
            <button type="button" className="btn-remove-line" onClick={() => setAdjustments(adjustments.filter((_, j) => j !== idx))}>×</button>
          </div>
        ))}
        <button type="button" className="btn-ghost" onClick={() => setAdjustments([...adjustments, { label: "", amount: "" }])}>{t("zakat.addAdjustment")}</button>
        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          <button className="btn-primary" disabled={busy || !companyId} onClick={compute}>{t("zakat.compute")}</button>
          {data && <button className="btn-secondary" disabled={busy} onClick={save}>{t("zakat.saveDeclaration")}</button>}
        </div>
        {error && <p className="balance-bad">{error}</p>}
      </div>

      {data && (
        <div className="panel">
          <h4>{t("zakat.result")}</h4>
          {data.reviewCount > 0 && <p className="balance-bad">{t("zakat.reviewWarning", { count: data.reviewCount })}</p>}
          <table className="ledger-table">
            <tbody>
              <tr><td>{t("zakat.row.bookNetProfit")}</td><td className="num">{money(i.bookNetProfit)}</td></tr>
              {rows.map(([key, value, strong]) => (
                <tr key={key} className={strong ? "net-row" : undefined}><td className={strong ? "strong" : undefined}>{t(`zakat.row.${key}`)}</td><td className={"num" + (strong ? " strong" : "")}>{money(value)}</td></tr>
              ))}
              {r.minBaseApplied && <tr><td colSpan={2} className="vat-note">{t("zakat.minApplied")}</td></tr>}
              {r.maxBaseApplied && <tr><td colSpan={2} className="vat-note">{t("zakat.maxApplied")}</td></tr>}
              <tr className="net-row"><td className="strong">{t("zakat.row.zakatBase")}</td><td className="num strong">{money(r.zakatBase)}</td></tr>
              <tr><td>{t("zakat.row.rate", { days: data.periodDays })}</td><td className="num">{data.ratePercent.toFixed(4)}%</td></tr>
              <tr><td>{t("zakat.row.zakatBeforeOwnership")}</td><td className="num">{money(r.zakatBeforeOwnership)}</td></tr>
              <tr className="net-row"><td className="strong">{t("zakat.row.zakatDue", { pct: data.zakatableOwnershipPct })}</td><td className="num strong">{money(r.zakatDue)}</td></tr>
            </tbody>
          </table>
          <h4>{t("zakat.accounts")}</h4>
          <p className="vat-note">{t("zakat.accountsNote")}</p>
          <table className="ledger-table">
            <thead><tr><th>{t("zakat.account")}</th><th>{t("zakat.balance")}</th><th>{t("zakat.treatment")}</th></tr></thead>
            <tbody>
              {data.accounts.map((a) => (
                <tr key={a.accountId}>
                  <td>{a.code} — {a.name}{a.needsReview && <span className="balance-bad"> · {t("zakat.needsReview")}</span>}</td>
                  <td className="num">{money(a.balance)}</td>
                  <td>
                    <select value={a.source === "own" ? a.treatment : ""} disabled={busy} onChange={(e) => changeTreatment(a.accountId, e.target.value)}>
                      <option value="">{t("zakat.auto", { value: t(`zakat.treatments.${a.treatment}`) })}</option>
                      {(TREATMENTS_BY_TYPE[a.type] || []).map((tr) => <option key={tr} value={tr}>{t(`zakat.treatments.${tr}`)}</option>)}
                    </select>
                    {a.source === "inherited" && <span className="vat-note"> ({t("zakat.inherited")})</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel">
        <h4>{t("zakat.declarations")}</h4>
        <table className="ledger-table">
          <thead><tr><th>{t("zakat.period")}</th><th>{t("zakat.method")}</th><th>{t("zakat.row.zakatDue", { pct: "" })}</th><th>{t("zakat.entry")}</th><th /></tr></thead>
          <tbody>
            {declarations.length === 0 && <tr><td colSpan={5} className="vat-note">{t("zakat.noDeclarations")}</td></tr>}
            {declarations.map((d) => (
              <tr key={d.id}>
                <td>{day(d.periodStart)} — {day(d.periodEnd)}</td>
                <td>{t(`zakat.methods.${d.method}`)}</td>
                <td className="num">{money(d.zakatDue)}</td>
                <td>{d.journalEntry ? d.journalEntry.entryNumber : "—"}</td>
                <td>
                  {!d.journalEntryId && Number(d.zakatDue) > 0 && <button className="btn-ghost" disabled={busy} onClick={() => setPosting(d)}>{t("zakat.post")}</button>}
                  {!d.journalEntryId && <button className="btn-ghost" disabled={busy} onClick={() => { if (window.confirm(t("zakat.deleteConfirm"))) run(async () => { await deleteZakatDeclaration(d.id); loadDeclarations(); }); }}>{t("zakat.delete")}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PostDialog declaration={posting} companyId={companyId} onClose={() => setPosting(null)} onPosted={() => { setPosting(null); loadDeclarations(); }} />
    </div>
  );
}

function PostDialog({ declaration, companyId, onClose, onPosted }) {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState([]);
  const [expenseAccountId, setExpense] = useState("");
  const [payableAccountId, setPayable] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!declaration) return;
    listAccounts({ companyId, includePartyAccounts: false }).then((all) => setAccounts((all || []).filter((a) => a.isPosting && !a.isArchived))).catch(() => undefined);
  }, [declaration, companyId]);
  const submit = async () => {
    setError("");
    try { await postZakatDeclaration(declaration.id, { expenseAccountId, payableAccountId }); onPosted(); } catch (e) { setError(e.message); }
  };
  return (
    <FormDialog open={Boolean(declaration)} title={t("zakat.post")} onClose={onClose}>
      {declaration && <p className="vat-note">{t("zakat.postNote", { amount: money(declaration.zakatDue), date: day(declaration.periodEnd) })}</p>}
      <label>{t("zakat.expenseAccount")}<AccountSearchSelect accounts={accounts.filter((a) => a.type === "expense")} value={expenseAccountId} onChange={setExpense} /></label>
      <label>{t("zakat.payableAccount")}<AccountSearchSelect accounts={accounts.filter((a) => a.type === "liability")} value={payableAccountId} onChange={setPayable} /></label>
      {error && <p className="balance-bad">{error}</p>}
      <div style={{ marginTop: 12 }}><button className="btn-primary" disabled={!expenseAccountId || !payableAccountId} onClick={submit}>{t("zakat.post")}</button></div>
    </FormDialog>
  );
}
