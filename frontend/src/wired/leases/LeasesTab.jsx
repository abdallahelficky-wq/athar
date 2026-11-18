import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import * as api from "../../api/leaseContracts";
import { listAccounts } from "../../api/accounts";
import { listCostCenters } from "../../api/costCenters";
import { formatDate } from "../../i18n/dateFormat";
import { fmt2 } from "../../legacy/constants";
import { routes } from "../../routes";
import FormDialog from "../shared/FormDialog";
import AccountSearchSelect from "../shared/AccountSearchSelect";

/**
 * الإيجارات: تقويم دفعات عقود الإيجار (عقد × شهر)، تأكيد السداد بقيد آلي (إيجار مدفوع مقدماً + ضريبة مدخلات / البنك)،
 * وإطفاء المصروف شهرياً. ثلاثة عروض: التقويم، العقود، الإطفاء الشهري. المنطق والقيود في src/modules/leaseContracts.
 */
const localDay = (d = new Date()) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
const pad = (n) => String(n).padStart(2, "0");
const monthOf = (day) => day.slice(0, 7);
const addMonth = (month, n) => { const [y, m] = month.split("-").map(Number); const i = y * 12 + m - 1 + n; return `${Math.floor(i / 12)}-${pad((i % 12) + 1)}`; };
const monthEnd = (month) => { const [y, m] = month.split("-").map(Number); return `${month}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`; };
const monthsBetween = (from, to) => { const out = []; for (let m = from; m <= to && out.length < 36; m = addMonth(m, 1)) out.push(m); return out; };

const TONE = {
  paid: { background: "rgba(47,125,79,0.12)", color: "#1F5C3A", border: "1px solid rgba(47,125,79,0.35)" },
  due: { background: "rgba(183,121,31,0.10)", color: "#7A5212", border: "1px solid rgba(183,121,31,0.35)" },
  overdue: { background: "rgba(168,67,43,0.12)", color: "#8A2F1B", border: "1px solid rgba(168,67,43,0.45)" },
  waived: { background: "var(--athar-bg)", color: "var(--athar-muted, #777)", border: "1px dashed var(--athar-border)" },
};
const toneOf = (p) => (p.status === "due" && p.overdue ? "overdue" : p.status);
const CELL_BTN = { display: "block", width: "100%", borderRadius: 8, padding: "4px 6px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", margin: "2px 0", direction: "ltr" };
const SUB = { fontSize: 12, lineHeight: 1.5, opacity: 0.7, fontWeight: 400, fontFamily: "inherit" };
const emptyContract = {
  title: "", counterparty: "", costCenterId: "", vatMode: "none", paymentAmount: "", paymentEveryMonths: "", firstDueDate: "", startDate: "", endDate: "", expenseAccountId: "", prepaidAccountId: "", notes: "", isActive: true,
  contractNumber: "", signedOn: "", contractValue: "", depositAmount: "", noticeDays: "", autoRenew: false, customTerms: "", lessor: {}, property: {},
};
const LESSOR_FIELDS = ["idNumber", "crNumber", "unifiedNumber", "vatNumber", "representative", "representativeId", "mobile", "email", "address", "iban"];
const PROPERTY_FIELDS = ["address", "city", "unitType", "area", "deedNumber"];
const ALERT_TONE = { expired: "overdue", notice_passed: "overdue", notice_soon: "due" };

export default function LeasesTab({ companyId }) {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState("calendar");
  const [range, setRange] = useState(() => { const m = monthOf(localDay()); return { from: m, to: addMonth(m, 12) }; });
  const [data, setData] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [dialog, setDialog] = useState(""); // "" | contract | accounts | payment | newPayment | generate | reverse | removeRun
  const [form, setForm] = useState({});
  const [amortMonth, setAmortMonth] = useState(() => monthOf(localDay()));
  const [preview, setPreview] = useState(null);
  const [runs, setRuns] = useState([]);
  const [alerts, setAlerts] = useState(null);
  const fileRef = useRef(null);

  // تواريخ الاستحقاق والسداد أيام تقويمية مخزَّنة منتصف ليل UTC — تُعرَض بتوقيت UTC فلا تنزاح يوماً
  const fmtDay = (v) => formatDate(v, i18n.language, { timeZone: "UTC" });
  const fmtMonth = (m) => formatDate(`${m}-01`, i18n.language, { timeZone: "UTC", month: "short", year: "numeric" });
  const postingAccounts = useMemo(() => accounts.filter((a) => a.isPosting && a.isActive && !a.isArchived), [accounts]);
  const bankAccounts = useMemo(() => postingAccounts.filter((a) => a.isBankOrCash), [postingAccounts]);
  const companyCostCenters = useMemo(() => costCenters.filter((c) => !c.companyId || c.companyId === companyId), [costCenters, companyId]);
  const months = useMemo(() => monthsBetween(range.from, range.to), [range.from, range.to]);

  useEffect(() => {
    if (!companyId) return;
    Promise.all([listAccounts({ companyId }), listCostCenters()])
      .then(([a, c]) => { setAccounts(a); setCostCenters(c); })
      .catch((e) => setError(e.message));
  }, [companyId]);

  const load = () => Promise.all([api.leaseCalendar(companyId, `${range.from}-01`, monthEnd(range.to)), api.leaseAlerts(companyId)])
    .then(([c, a]) => { setData(c); setAlerts(a); })
    .catch((e) => setError(e.message));
  const loadAmortization = () => Promise.all([api.previewLeaseAmortization(companyId, amortMonth), api.listLeaseAmortizationRuns(companyId)])
    .then(([p, r]) => { setPreview(p); setRuns(r); })
    .catch((e) => setError(e.message));
  useEffect(() => { if (companyId && range.from <= range.to) load(); }, [companyId, range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (companyId && view === "amortization" && amortMonth) loadAmortization(); }, [companyId, view, amortMonth]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => setDialog("");
  const open = (name, initial = {}) => { setError(""); setMessage(""); setForm(initial); setDialog(name); };
  const run = async (fn, okKey, okParams) => {
    setError("");
    try {
      const result = await fn();
      close();
      setMessage(t(okKey, { ...okParams, ...(result && typeof result === "object" ? result : {}) }));
      await load();
      if (view === "amortization") await loadAmortization();
    } catch (e) { setError(e.message); }
  };

  // --- العقود ---
  const openContract = (c) => open("contract", c
    ? {
      ...emptyContract, ...c, counterparty: c.counterparty || "", costCenterId: c.costCenterId || "", paymentAmount: c.paymentAmount ?? "", paymentEveryMonths: c.paymentEveryMonths ?? "", firstDueDate: c.firstDueDate || "", expenseAccountId: c.expenseAccountId || "", prepaidAccountId: c.prepaidAccountId || "", notes: c.notes || "",
      contractNumber: c.contractNumber || "", signedOn: c.signedOn || "", contractValue: c.contractValue ?? "", depositAmount: c.depositAmount ?? "", noticeDays: c.noticeDays ?? "", autoRenew: !!c.autoRenew, customTerms: c.customTerms || "",
      lessor: { ...(c.lessorDetails || {}) }, property: { ...(c.propertyDetails || {}) },
    }
    : emptyContract);
  const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
  const details = (obj, fields) => { const out = Object.fromEntries(fields.filter((k) => (obj?.[k] || "").trim()).map((k) => [k, obj[k].trim()])); return out; };
  const saveContract = () => {
    if (!form.title?.trim() || !form.startDate || !form.endDate) { setError(t("leases.errRequired")); return undefined; }
    const payload = {
      title: form.title.trim(), counterparty: form.counterparty.trim() || null, costCenterId: form.costCenterId || null, vatMode: form.vatMode,
      paymentAmount: form.paymentAmount === "" ? null : Number(form.paymentAmount), paymentEveryMonths: form.paymentEveryMonths === "" ? null : Number(form.paymentEveryMonths),
      firstDueDate: form.firstDueDate || null, startDate: form.startDate, endDate: form.endDate,
      expenseAccountId: form.expenseAccountId || null, prepaidAccountId: form.prepaidAccountId || null, notes: form.notes.trim() || null, isActive: form.isActive,
      contractNumber: form.contractNumber.trim() || null, signedOn: form.signedOn || null, contractValue: num(form.contractValue), depositAmount: num(form.depositAmount),
      noticeDays: num(form.noticeDays), autoRenew: !!form.autoRenew, customTerms: form.customTerms.trim() || null,
      lessorDetails: (() => { const d = details(form.lessor, LESSOR_FIELDS); if (form.lessor?.type) d.type = form.lessor.type; return Object.keys(d).length ? d : null; })(),
      propertyDetails: (() => { const d = details(form.property, PROPERTY_FIELDS); return Object.keys(d).length ? d : null; })(),
    };
    return run(() => (form.id ? api.updateLeaseContract(form.id, payload) : api.createLeaseContract({ companyId, ...payload })), "leases.savedOk");
  };
  const removeContract = (c) => {
    if (!window.confirm(t("leases.confirmDeleteContract", { title: c.title }))) return;
    run(() => api.deleteLeaseContract(c.id), "leases.deletedOk");
  };
  const importFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(""); setMessage("");
    try {
      const parsed = JSON.parse(await file.text());
      const contracts = Array.isArray(parsed) ? parsed : parsed.contracts;
      if (!Array.isArray(contracts)) throw new Error(t("leases.importBadFile"));
      const result = await api.importLeaseContracts(companyId, contracts);
      setMessage(t("leases.importedOk", result));
      await load();
    } catch (err) { setError(err instanceof SyntaxError ? t("leases.importBadFile") : err.message); }
  };

  // --- بريد التنبيهات اليومي ---
  const openReminder = async () => {
    setError(""); setMessage("");
    try {
      const r = await api.getLeaseReminder(companyId);
      setForm({ enabled: r.enabled, hourKsa: r.hourKsa, minuteKsa: r.minuteKsa ?? 0, emails: r.recipientEmails.join("\n"), effective: r.effectiveRecipients, lastSentAt: r.lastSentAt });
      setDialog("reminder");
    } catch (e) { setError(e.message); }
  };
  const reminderPayload = () => ({ companyId, enabled: !!form.enabled, hourKsa: Number(form.hourKsa), minuteKsa: Number(form.minuteKsa ?? 0), recipientEmails: (form.emails || "").split(/[\s,،;]+/).map((x) => x.trim()).filter(Boolean) });
  const saveReminder = () => run(() => api.saveLeaseReminder(reminderPayload()).then(() => undefined), "leases.reminder.savedOk");
  const sendReminderNow = async () => {
    setError("");
    try {
      await api.saveLeaseReminder(reminderPayload());
      const r = await api.sendLeaseReminderNow(companyId);
      close();
      setMessage(r.sent ? t("leases.reminder.sentOk", { count: r.recipients }) : t(`leases.reminder.notSent.${r.reason}`));
    } catch (e) { setError(e.message); }
  };

  // --- الدفعات ---
  const contractOf = (id) => data?.contracts.find((c) => c.id === id);
  const openPayment = (p) => open("payment", {
    ...p, mode: "view", paidOnInput: localDay(), bankAccountId: bankAccounts[0]?.id || "", amountInput: p.amount, referenceInput: "", noteInput: p.note || "",
    external: false, amortizeFromMonth: "", editDueDate: p.dueDate, editFrom: p.periodFrom, editTo: p.periodTo,
  });
  const confirmPayment = () => run(() => api.confirmLeasePayment(form.id, {
    paidOn: form.paidOnInput, amount: Number(form.amountInput), reference: form.referenceInput || null, note: form.noteInput || null,
    ...(form.external ? { postedExternally: true, amortizeFromMonth: form.amortizeFromMonth || null } : { bankAccountId: form.bankAccountId }),
  }), "leases.confirmedOk");
  const savePaymentEdit = () => run(() => api.updateLeasePayment(form.id, { dueDate: form.editDueDate, periodFrom: form.editFrom, periodTo: form.editTo, amount: Number(form.amountInput), note: form.noteInput || null }), "leases.savedOk");
  const setWaived = (waived) => run(() => api.updateLeasePayment(form.id, { status: waived ? "waived" : "due", note: form.noteInput || null }), "leases.savedOk");
  const removePayment = () => {
    if (!window.confirm(t("leases.confirmDeletePayment"))) return;
    run(() => api.deleteLeasePayment(form.id), "leases.deletedOk");
  };
  const saveNewPayment = () => run(() => api.createLeasePayment({
    leaseContractId: form.leaseContractId, dueDate: form.dueDate, periodFrom: form.periodFrom, periodTo: form.periodTo, amount: Number(form.amount), note: form.note || null,
  }), "leases.savedOk");
  const saveReverse = () => {
    if (!form.reason?.trim()) { setError(t("leases.reasonRequired")); return undefined; }
    return run(() => api.reverseLeasePayment(form.id, form.reason.trim()), "leases.reversedOk");
  };

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;
  const contracts = data?.contracts || [];
  const payments = data?.payments || [];
  const totals = data?.totals || {};
  const cell = (contractId, month) => payments.filter((p) => p.leaseContractId === contractId && p.month === month);
  const monthTotal = (month) => data?.months.find((m) => m.month === month);
  // معاينة القيد قبل التأكيد فقط (15%): الخادم يفصل الضريبة بنسبة الشركة عند الترحيل
  const previewGross = Number(form.amountInput || 0);
  const previewVat = contractOf(form.leaseContractId)?.vatMode === "inclusive" ? Math.round((previewGross * 15 / 115) * 100) / 100 : 0;
  const kpis = [
    { key: "due", value: totals.due, tone: "revenue" }, { key: "paid", value: totals.paid, tone: "profit" },
    { key: "outstanding", value: totals.outstanding, tone: "receivable" }, { key: "overdue", value: totals.overdue, tone: "payable" },
    { key: "vat", value: totals.vat, tone: "cash" },
  ];
  const formContract = form.leaseContractId ? contractOf(form.leaseContractId) : null;

  return (
    <div>
      <div className="panel">
        <div className="form-btn-group" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>{t("leases.title")}</h3>
          <div className="form-btn-group" style={{ gap: 6, flexWrap: "wrap" }}>
            <button className="btn-ghost" onClick={() => fileRef.current?.click()}>{t("leases.importBtn")}</button>
            <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: "none" }} onChange={importFile} />
            <button className="btn-ghost" onClick={openReminder}>{t("leases.reminder.btn")}</button>
            <button className="btn-ghost" onClick={() => open("accounts", { expenseAccountId: "", prepaidAccountId: "", onlyMissing: true })} disabled={!contracts.length}>{t("leases.accountsBtn")}</button>
            <button className="btn-primary" onClick={() => openContract(null)}>+ {t("leases.newContract")}</button>
          </div>
        </div>
        <p className="note">{t("leases.note")}</p>
        <div className="form-btn-group" style={{ gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {["calendar", "contracts", "amortization"].map((v) => (
            <button key={v} type="button" className={view === v ? "btn-primary" : "btn-ghost"} onClick={() => { setError(""); setMessage(""); setView(v); }}>{t(`leases.views.${v}`)}</button>
          ))}
        </div>
        {error && !dialog && <p className="balance-bad">{error}</p>}
        {message && <p className="note">{message}</p>}
        {alerts && (alerts.overdue.length + alerts.dueSoon.length + alerts.renewals.length > 0) && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10, margin: "0 0 14px" }}>
            {[
              { key: "overdue", rows: alerts.overdue, tone: "overdue", total: alerts.totals.overdue },
              { key: "dueSoon", rows: alerts.dueSoon, tone: "due", total: alerts.totals.dueSoon },
            ].filter((g) => g.rows.length > 0).map((g) => (
              <div key={g.key} role="status" style={{ ...TONE[g.tone], borderRadius: 10, padding: "10px 14px", fontSize: 13 }}>
                <strong>{t(`leases.alerts.${g.key}`, { count: g.rows.length, days: alerts.dueWithinDays })} · {fmt2(g.total)}</strong>
                <ul style={{ margin: "6px 0 0", paddingInlineStart: 18 }}>
                  {g.rows.slice(0, 6).map((p) => <li key={p.id}>{p.title} — {fmt2(p.amount)} — {fmtDay(p.dueDate)} ({t(p.days < 0 ? "leases.alerts.daysLate" : "leases.alerts.daysLeft", { count: Math.abs(p.days) })})</li>)}
                  {g.rows.length > 6 && <li>{t("leases.alerts.more", { count: g.rows.length - 6 })}</li>}
                </ul>
              </div>
            ))}
            {alerts.renewals.length > 0 && (
              <div role="status" style={{ ...TONE.due, borderRadius: 10, padding: "10px 14px", fontSize: 13 }}>
                <strong>{t("leases.alerts.renewals", { count: alerts.renewals.length, days: alerts.renewalWithinDays })}</strong>
                <ul style={{ margin: "6px 0 0", paddingInlineStart: 18 }}>
                  {alerts.renewals.slice(0, 8).map((r) => (
                    <li key={r.id} style={{ color: TONE[ALERT_TONE[r.kind]].color }}>
                      {r.title} — {t(`leases.alerts.kinds.${r.kind}`, { date: fmtDay(r.kind === "expired" ? r.endDate : r.noticeDeadline), count: Math.abs(r.kind === "expired" ? r.daysToEnd : r.daysToDeadline) })}
                    </li>
                  ))}
                  {alerts.renewals.length > 8 && <li>{t("leases.alerts.more", { count: alerts.renewals.length - 8 })}</li>}
                </ul>
              </div>
            )}
          </div>
        )}

        {view !== "amortization" && (
          <>
            <div className="filter-bar" style={{ maxWidth: 420 }}>
              <label>{t("leases.fromMonth")}<input type="month" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} /></label>
              <label>{t("leases.toMonth")}<input type="month" value={range.to} min={range.from} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} /></label>
            </div>
            <div className="kpi-row" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
              {kpis.map((k) => (
                <div key={k.key} className={`kpi-card kpi-card-${k.tone}`} style={{ borderRadius: 12 }}>
                  <div className="kpi-label">{t(`leases.kpi.${k.key}`)}{k.key === "overdue" && totals.overdueCount ? ` (${totals.overdueCount})` : ""}</div>
                  <div className="kpi-value">{fmt2(k.value || 0)}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {view === "calendar" && (
        <div className="panel">
          <div className="form-btn-group" style={{ gap: 14, flexWrap: "wrap", fontSize: 12.5, marginBottom: 8 }}>
            {["paid", "due", "overdue", "waived"].map((k) => (
              <span key={k}><span style={{ ...TONE[k], display: "inline-block", width: 12, height: 12, borderRadius: 3, verticalAlign: "-1px", marginInlineEnd: 5 }} />{t(`leases.statuses.${k}`)}</span>
            ))}
          </div>
          <div className="lines-table-wrap">
            <table className="ledger-table" style={{ minWidth: 220 + months.length * 96 }}>
              <thead><tr>
                <th style={{ position: "sticky", insetInlineStart: 0, background: "var(--athar-surface, #fff)", zIndex: 1, minWidth: 220 }}>{t("leases.contract")}</th>
                {months.map((m) => <th key={m} style={{ minWidth: 96, textAlign: "center" }}>{fmtMonth(m)}</th>)}
              </tr></thead>
              <tbody>
                {contracts.map((c) => (
                  <tr key={c.id} style={c.isActive ? undefined : { opacity: 0.55 }}>
                    <td style={{ position: "sticky", insetInlineStart: 0, background: "var(--athar-surface, #fff)", zIndex: 1 }}>
                      <strong>{c.title}</strong>
                      <div style={SUB}>{t(`leases.vatModes.${c.vatMode}`)}{c.costCenterName ? ` · ${c.costCenterName}` : ""}</div>
                    </td>
                    {months.map((m) => (
                      <td key={m} style={{ textAlign: "center", padding: "3px 4px" }}>
                        {cell(c.id, m).map((p) => (
                          <button key={p.id} type="button" title={`${fmtDay(p.dueDate)}${p.note ? ` — ${p.note}` : ""}`} style={{ ...CELL_BTN, ...TONE[toneOf(p)] }} onClick={() => openPayment(p)}>
                            {p.status === "waived" ? t("leases.statuses.waived") : fmt2(p.amount)}{p.status === "paid" ? " ✓" : ""}
                          </button>
                        ))}
                      </td>
                    ))}
                  </tr>
                ))}
                {data && contracts.length === 0 && <tr><td className="empty" colSpan={months.length + 1}>{t("leases.noContracts")}</td></tr>}
              </tbody>
              {contracts.length > 0 && (
                <tfoot>
                  {["due", "paid", "outstanding", "vat"].map((k) => (
                    <tr key={k}>
                      <td className="foot-label" style={{ position: "sticky", insetInlineStart: 0, background: "var(--athar-surface, #fff)" }}>{t(`leases.kpi.${k}`)}</td>
                      {months.map((m) => <td key={m} className={`num${k === "due" ? " strong" : ""}`} style={{ textAlign: "center" }}>{monthTotal(m) ? fmt2(monthTotal(m)[k]) : "—"}</td>)}
                    </tr>
                  ))}
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {view === "contracts" && (
        <div className="panel">
          <div className="lines-table-wrap">
            <table className="ledger-table">
              <thead><tr>
                <th>{t("leases.contract")}</th><th>{t("leases.counterparty")}</th><th>{t("leases.costCenter")}</th><th>{t("leases.vatMode")}</th>
                <th>{t("leases.terms")}</th><th>{t("leases.period")}</th><th>{t("leases.accounts")}</th><th></th>
              </tr></thead>
              <tbody>
                {contracts.map((c) => (
                  <tr key={c.id} style={c.isActive ? undefined : { opacity: 0.55 }}>
                    <td><strong>{c.title}</strong>{c.notes && <div style={SUB}>{c.notes}</div>}</td>
                    <td>{c.counterparty || "—"}{(c.lessorDetails?.mobile || c.contractNumber) && <div style={SUB}>{[c.lessorDetails?.mobile, c.contractNumber && `${t("leases.contractNumber")}: ${c.contractNumber}`].filter(Boolean).join(" · ")}</div>}</td>
                    <td>{c.costCenterName || "—"}</td>
                    <td>{t(`leases.vatModes.${c.vatMode}`)}</td>
                    <td>{c.paymentAmount && c.paymentEveryMonths ? t("leases.termsValue", { amount: fmt2(c.paymentAmount), count: c.paymentEveryMonths }) : "—"}</td>
                    <td>{fmtDay(c.startDate)} – {fmtDay(c.endDate)}
                      <div style={SUB}>{c.autoRenew ? t("leases.autoRenewShort") : t("leases.noAutoRenewShort")}{c.noticeDays ? ` · ${t("leases.noticeBy", { date: fmtDay(c.noticeDeadline), count: c.noticeDays })}` : ""}</div>
                    </td>
                    <td>{c.expenseAccountId && c.prepaidAccountId ? "✓" : <span style={{ color: "#B7791F" }}>{t("leases.accountsDefault")}</span>}</td>
                    <td className="row-actions">
                      <button className="btn-ghost" onClick={() => openContract(c)}>{t("common.edit")}</button>
                      <button className="btn-ghost" onClick={() => open("generate", { id: c.id, title: c.title, until: c.endDate })} disabled={!c.paymentAmount || !c.paymentEveryMonths || !c.firstDueDate}>{t("leases.generate")}</button>
                      <button className="btn-ghost" onClick={() => open("newPayment", { leaseContractId: c.id, dueDate: localDay(), periodFrom: localDay(), periodTo: localDay(), amount: c.paymentAmount ?? "", note: "" })}>+ {t("leases.payment")}</button>
                      <button className="btn-ghost" onClick={() => removeContract(c)}>{t("common.delete")}</button>
                    </td>
                  </tr>
                ))}
                {data && contracts.length === 0 && <tr><td className="empty" colSpan={8}>{t("leases.noContracts")}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === "amortization" && (
        <>
          <div className="panel">
            <p className="note">{t("leases.amortization.note")}</p>
            <div className="filter-bar" style={{ maxWidth: 260 }}>
              <label>{t("leases.amortization.month")}<input type="month" value={amortMonth} onChange={(e) => e.target.value && setAmortMonth(e.target.value)} /></label>
            </div>
            {preview?.alreadyPosted && <p className="note">{t("leases.amortization.alreadyPosted", { amount: fmt2(preview.existingRun.totalAmount) })}</p>}
            {preview?.unpaid?.length > 0 && (
              <div role="status" style={{ background: "rgba(183,121,31,0.08)", border: "1px solid rgba(183,121,31,0.28)", borderRadius: 10, padding: "10px 14px", margin: "0 0 14px", fontSize: 13, color: "#7A5212" }}>
                ⚠ {t("leases.amortization.unpaid", { count: preview.unpaid.length })}: {preview.unpaid.map((u) => `${u.title} (${fmt2(u.amount)})`).join("، ")}
              </div>
            )}
            <div className="lines-table-wrap">
              <table className="ledger-table">
                <thead><tr>
                  <th>{t("leases.contract")}</th><th>{t("leases.period")}</th><th>{t("leases.amortization.net")}</th>
                  <th>{t("leases.amortization.already")}</th><th>{t("leases.amortization.thisMonth")}</th><th>{t("leases.amortization.remaining")}</th>
                </tr></thead>
                <tbody>
                  {(preview?.rows || []).map((r) => (
                    <tr key={r.leasePaymentId}>
                      <td>{r.title}</td><td>{fmtDay(r.periodFrom)} – {fmtDay(r.periodTo)}</td><td className="num">{fmt2(r.netAmount)}</td>
                      <td className="num">{fmt2(r.alreadyAmortized)}</td>
                      <td className="num strong">{fmt2(r.amount)}{r.amount !== r.monthShare && <div style={SUB}>{t("leases.amortization.catchUp")}</div>}</td>
                      <td className="num">{fmt2(r.remainingAfter)}</td>
                    </tr>
                  ))}
                  {preview && preview.rows.length === 0 && <tr><td className="empty" colSpan={6}>{t("leases.amortization.empty")}</td></tr>}
                </tbody>
                {preview?.rows.length > 0 && <tfoot><tr><td className="foot-label" colSpan={4}>{t("leases.amortization.total")}</td><td className="num strong">{fmt2(preview.total)}</td><td></td></tr></tfoot>}
              </table>
            </div>
            <div className="form-btn-group">
              <button className="btn-primary" disabled={!preview || preview.alreadyPosted || preview.rows.length === 0} onClick={() => run(() => api.postLeaseAmortization(companyId, amortMonth), "leases.amortization.postedOk")}>{t("leases.amortization.postBtn")}</button>
            </div>
          </div>
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>{t("leases.amortization.runsTitle")}</h3>
            <table className="ledger-table">
              <thead><tr><th>{t("leases.amortization.month")}</th><th>{t("leases.amortization.total")}</th><th>{t("leases.entryNumber")}</th><th></th></tr></thead>
              <tbody>
                {runs.map((r, i) => (
                  <tr key={r.id}>
                    <td>{fmtMonth(r.month)}</td><td className="num">{fmt2(r.totalAmount)}</td>
                    <td><Link to={routes.journalEntry(r.journalEntryId)}>{r.entryNumber}</Link></td>
                    <td className="row-actions">{i === 0 && <button className="btn-ghost" onClick={() => open("removeRun", { id: r.id, month: r.month, pin: "" })}>{t("leases.amortization.remove")}</button>}</td>
                  </tr>
                ))}
                {runs.length === 0 && <tr><td className="empty" colSpan={4}>{t("leases.amortization.noRuns")}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      <FormDialog open={dialog === "contract"} title={form.id ? t("leases.editContract") : t("leases.newContract")} onClose={close} style={{ maxWidth: 760 }}>
        <div className="form-grid">
          <label>{t("leases.contractTitle")}<input value={form.title || ""} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
          <label>{t("leases.counterparty")}<input value={form.counterparty || ""} onChange={(e) => setForm({ ...form, counterparty: e.target.value })} /></label>
          <label>{t("leases.costCenter")}
            <select value={form.costCenterId || ""} onChange={(e) => setForm({ ...form, costCenterId: e.target.value })}>
              <option value="">—</option>
              {companyCostCenters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>{t("leases.vatMode")}
            <select value={form.vatMode || "none"} onChange={(e) => setForm({ ...form, vatMode: e.target.value })}>
              <option value="none">{t("leases.vatModes.none")}</option><option value="inclusive">{t("leases.vatModes.inclusive")}</option>
            </select>
          </label>
          <label>{t("leases.startDate")}<input type="date" value={form.startDate || ""} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></label>
          <label>{t("leases.endDate")}<input type="date" value={form.endDate || ""} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></label>
          <label>{t("leases.paymentAmount")}<input type="number" step="0.01" min="0" value={form.paymentAmount ?? ""} onChange={(e) => setForm({ ...form, paymentAmount: e.target.value })} /></label>
          <label>{t("leases.everyMonths")}<input type="number" step="1" min="1" value={form.paymentEveryMonths ?? ""} onChange={(e) => setForm({ ...form, paymentEveryMonths: e.target.value })} /></label>
          <label>{t("leases.firstDueDate")}<input type="date" value={form.firstDueDate || ""} onChange={(e) => setForm({ ...form, firstDueDate: e.target.value })} /></label>
          <label style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}><input type="checkbox" checked={form.isActive !== false} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />{t("leases.active")}</label>
          <label>{t("leases.contractNumber")}<input value={form.contractNumber || ""} onChange={(e) => setForm({ ...form, contractNumber: e.target.value })} /></label>
          <label>{t("leases.signedOn")}<input type="date" value={form.signedOn || ""} onChange={(e) => setForm({ ...form, signedOn: e.target.value })} /></label>
          <label>{t("leases.contractValue")}<input type="number" step="0.01" min="0" value={form.contractValue ?? ""} onChange={(e) => setForm({ ...form, contractValue: e.target.value })} /></label>
          <label>{t("leases.depositAmount")}<input type="number" step="0.01" min="0" value={form.depositAmount ?? ""} onChange={(e) => setForm({ ...form, depositAmount: e.target.value })} /></label>
          <label>{t("leases.noticeDays")}<input type="number" step="1" min="0" value={form.noticeDays ?? ""} onChange={(e) => setForm({ ...form, noticeDays: e.target.value })} /></label>
          <label style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}><input type="checkbox" checked={!!form.autoRenew} onChange={(e) => setForm({ ...form, autoRenew: e.target.checked })} />{t("leases.autoRenew")}</label>
          <h4 className="sub-head" style={{ gridColumn: "1 / -1", margin: "6px 0 0" }}>{t("leases.lessorTitle")}</h4>
          <label>{t("leases.lessor.type")}
            <select value={form.lessor?.type || ""} onChange={(e) => setForm({ ...form, lessor: { ...form.lessor, type: e.target.value } })}>
              <option value="">—</option><option value="company">{t("leases.lessor.company")}</option><option value="individual">{t("leases.lessor.individual")}</option>
            </select>
          </label>
          {LESSOR_FIELDS.map((k) => (
            <label key={k}>{t(`leases.lessor.${k}`)}<input value={form.lessor?.[k] || ""} onChange={(e) => setForm({ ...form, lessor: { ...form.lessor, [k]: e.target.value } })} /></label>
          ))}
          <h4 className="sub-head" style={{ gridColumn: "1 / -1", margin: "6px 0 0" }}>{t("leases.propertyTitle")}</h4>
          {PROPERTY_FIELDS.map((k) => (
            <label key={k}>{t(`leases.property.${k}`)}<input value={form.property?.[k] || ""} onChange={(e) => setForm({ ...form, property: { ...form.property, [k]: e.target.value } })} /></label>
          ))}
          <label style={{ gridColumn: "1 / -1" }}>{t("leases.customTerms")}<textarea rows={3} style={{ width: "100%" }} value={form.customTerms || ""} onChange={(e) => setForm({ ...form, customTerms: e.target.value })} /></label>
          <h4 className="sub-head" style={{ gridColumn: "1 / -1", margin: "6px 0 0" }}>{t("leases.accounts")}</h4>
          <label style={{ gridColumn: "1 / -1" }}>{t("leases.prepaidAccount")}
            <AccountSearchSelect accounts={postingAccounts} value={form.prepaidAccountId} onChange={(id) => setForm({ ...form, prepaidAccountId: id })} allowClear />
          </label>
          <label style={{ gridColumn: "1 / -1" }}>{t("leases.expenseAccount")}
            <AccountSearchSelect accounts={postingAccounts} value={form.expenseAccountId} onChange={(id) => setForm({ ...form, expenseAccountId: id })} allowClear />
          </label>
          <label style={{ gridColumn: "1 / -1" }}>{t("leases.notes")}<input value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
        </div>
        <p className="note">{t("leases.accountsHint")}</p>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group"><button className="btn-ghost" onClick={close}>{t("common.cancel")}</button><button className="btn-primary" onClick={saveContract}>{t("common.save")}</button></div>
      </FormDialog>

      <FormDialog open={dialog === "accounts"} title={t("leases.accountsBtn")} onClose={close} style={{ maxWidth: 620 }}>
        <p className="note">{t("leases.accountsDialogNote")}</p>
        <label>{t("leases.prepaidAccount")}<AccountSearchSelect accounts={postingAccounts} value={form.prepaidAccountId} onChange={(id) => setForm({ ...form, prepaidAccountId: id })} allowClear /></label>
        <label>{t("leases.expenseAccount")}<AccountSearchSelect accounts={postingAccounts} value={form.expenseAccountId} onChange={(id) => setForm({ ...form, expenseAccountId: id })} allowClear /></label>
        <label style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 }}><input type="checkbox" checked={!!form.onlyMissing} onChange={(e) => setForm({ ...form, onlyMissing: e.target.checked })} />{t("leases.onlyMissing")}</label>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group"><button className="btn-ghost" onClick={close}>{t("common.cancel")}</button>
          <button className="btn-primary" disabled={!form.expenseAccountId && !form.prepaidAccountId} onClick={() => run(() => api.applyLeaseAccounts({ companyId, expenseAccountId: form.expenseAccountId || null, prepaidAccountId: form.prepaidAccountId || null, onlyMissing: !!form.onlyMissing }), "leases.accountsAppliedOk")}>{t("common.save")}</button>
        </div>
      </FormDialog>

      <FormDialog open={dialog === "reminder"} title={t("leases.reminder.title")} onClose={close} style={{ maxWidth: 560 }}>
        <p className="note">{t("leases.reminder.note")}</p>
        <label style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}><input type="checkbox" checked={!!form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />{t("leases.reminder.enabled")}</label>
        <label>{t("leases.reminder.hour")}
          <span style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, direction: "ltr", justifyContent: "flex-end" }}>
            <select value={form.hourKsa ?? 8} onChange={(e) => setForm({ ...form, hourKsa: e.target.value })}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}</option>)}
            </select>
            :
            <select value={form.minuteKsa ?? 0} onChange={(e) => setForm({ ...form, minuteKsa: e.target.value })}>
              {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => <option key={m} value={m}>{String(m).padStart(2, "0")}</option>)}
            </select>
          </span>
        </label>
        <label>{t("leases.reminder.emails")}<textarea rows={3} style={{ width: "100%", direction: "ltr" }} value={form.emails || ""} onChange={(e) => setForm({ ...form, emails: e.target.value })} /></label>
        {!(form.emails || "").trim() && <p className="note">{t("leases.reminder.defaultRecipients")}: <span style={{ direction: "ltr", unicodeBidi: "embed" }}>{(form.effective || []).join(", ") || "—"}</span></p>}
        {form.lastSentAt && <p className="note">{t("leases.reminder.lastSent")}: {fmtDay(form.lastSentAt)}</p>}
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group"><button className="btn-ghost" onClick={close}>{t("common.cancel")}</button><button className="btn-ghost" onClick={sendReminderNow}>{t("leases.reminder.sendNow")}</button><button className="btn-primary" onClick={saveReminder}>{t("common.save")}</button></div>
      </FormDialog>

      <FormDialog open={dialog === "generate"} title={`${t("leases.generate")} — ${form.title || ""}`} onClose={close} style={{ maxWidth: 480 }}>
        <p className="note">{t("leases.generateNote")}</p>
        <label>{t("leases.generateUntil")}<input type="date" value={form.until || ""} onChange={(e) => setForm({ ...form, until: e.target.value })} /></label>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group"><button className="btn-ghost" onClick={close}>{t("common.cancel")}</button><button className="btn-primary" onClick={() => run(() => api.generateLeaseSchedule(form.id, form.until || undefined), "leases.generatedOk")}>{t("leases.generate")}</button></div>
      </FormDialog>

      <FormDialog open={dialog === "newPayment"} title={`+ ${t("leases.payment")} — ${formContract?.title || ""}`} onClose={close} style={{ maxWidth: 560 }}>
        <div className="form-grid">
          <label>{t("leases.dueDate")}<input type="date" value={form.dueDate || ""} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></label>
          <label>{t("leases.amount")}<input type="number" step="0.01" min="0" value={form.amount ?? ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>
          <label>{t("leases.periodFrom")}<input type="date" value={form.periodFrom || ""} onChange={(e) => setForm({ ...form, periodFrom: e.target.value })} /></label>
          <label>{t("leases.periodTo")}<input type="date" value={form.periodTo || ""} onChange={(e) => setForm({ ...form, periodTo: e.target.value })} /></label>
          <label style={{ gridColumn: "1 / -1" }}>{t("leases.notes")}<input value={form.note || ""} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
        </div>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group"><button className="btn-ghost" onClick={close}>{t("common.cancel")}</button><button className="btn-primary" onClick={saveNewPayment}>{t("common.save")}</button></div>
      </FormDialog>

      <FormDialog open={dialog === "payment"} title={`${formContract?.title || ""} — ${form.dueDate ? fmtDay(form.dueDate) : ""}`} onClose={close} style={{ maxWidth: 640 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, background: "var(--athar-bg)", border: "1px solid var(--athar-border)", borderRadius: 10, padding: "10px 14px", margin: "0 0 12px" }}>
          <div><div style={SUB}>{t("leases.status")}</div><strong>{t(`leases.statuses.${form.status ? toneOf(form) : "due"}`)}</strong></div>
          <div><div style={SUB}>{t("leases.amount")}</div><strong>{fmt2(form.amount || 0)}</strong></div>
          <div><div style={SUB}>{t("leases.kpi.vat")}</div><strong>{fmt2(form.vatAmount || 0)}</strong></div>
          <div><div style={SUB}>{t("leases.period")}</div><strong style={{ fontSize: 12.5 }}>{form.periodFrom ? `${fmtDay(form.periodFrom)} – ${fmtDay(form.periodTo)}` : ""}</strong></div>
        </div>

        {form.status === "paid" && (
          <>
            <p className="note">
              {t("leases.paidOn")}: {fmtDay(form.paidOn)}
              {form.postedExternally ? ` · ${t("leases.externalBadge")}` : ""}
              {form.entryNumber && <> · {t("leases.entryNumber")}: <Link to={routes.journalEntry(form.journalEntryId)}>{form.entryNumber}</Link></>}
              {form.reference ? ` · ${form.reference}` : ""}
            </p>
            {form.note && <p className="note">{form.note}</p>}
            {error && <p className="balance-bad">{error}</p>}
            <div className="form-btn-group"><button className="btn-ghost" onClick={close}>{t("common.close")}</button><button className="btn-ghost" onClick={() => open("reverse", { id: form.id, reason: "" })}>{t("leases.reverse")}</button></div>
          </>
        )}

        {form.status === "waived" && (
          <>
            {form.note && <p className="note">{form.note}</p>}
            {error && <p className="balance-bad">{error}</p>}
            <div className="form-btn-group"><button className="btn-ghost" onClick={close}>{t("common.close")}</button><button className="btn-ghost" onClick={removePayment}>{t("common.delete")}</button><button className="btn-primary" onClick={() => setWaived(false)}>{t("leases.unwaive")}</button></div>
          </>
        )}

        {form.status === "due" && form.mode === "view" && (
          <>
            <div className="form-grid">
              <label>{t("leases.paidOn")}<input type="date" value={form.paidOnInput || ""} onChange={(e) => setForm({ ...form, paidOnInput: e.target.value })} /></label>
              <label>{t("leases.paidAmount")}<input type="number" step="0.01" min="0" value={form.amountInput ?? ""} onChange={(e) => setForm({ ...form, amountInput: e.target.value })} /></label>
              {!form.external && (
                <label style={{ gridColumn: "1 / -1" }}>{t("leases.bankAccount")}
                  <AccountSearchSelect accounts={bankAccounts} value={form.bankAccountId} onChange={(id) => setForm({ ...form, bankAccountId: id })} />
                </label>
              )}
              <label>{t("leases.reference")}<input value={form.referenceInput || ""} onChange={(e) => setForm({ ...form, referenceInput: e.target.value })} /></label>
              <label>{t("leases.notes")}<input value={form.noteInput || ""} onChange={(e) => setForm({ ...form, noteInput: e.target.value })} /></label>
              <label style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, gridColumn: "1 / -1" }}><input type="checkbox" checked={!!form.external} onChange={(e) => setForm({ ...form, external: e.target.checked })} />{t("leases.external")}</label>
              {form.external && <label>{t("leases.amortizeFrom")}<input type="month" value={form.amortizeFromMonth || ""} onChange={(e) => setForm({ ...form, amortizeFromMonth: e.target.value })} /></label>}
            </div>
            <p className="note">{form.external ? t("leases.externalNote") : t("leases.entryNote", { net: fmt2(previewGross - previewVat), vat: fmt2(previewVat), gross: fmt2(previewGross) })}</p>
            {error && <p className="balance-bad">{error}</p>}
            <div className="form-btn-group" style={{ flexWrap: "wrap" }}>
              <button className="btn-ghost" onClick={close}>{t("common.cancel")}</button>
              <button className="btn-ghost" onClick={() => setForm({ ...form, mode: "edit" })}>{t("common.edit")}</button>
              <button className="btn-ghost" onClick={() => setWaived(true)}>{t("leases.waive")}</button>
              <button className="btn-primary" onClick={confirmPayment}>{t("leases.confirm")}</button>
            </div>
          </>
        )}

        {form.status === "due" && form.mode === "edit" && (
          <>
            <div className="form-grid">
              <label>{t("leases.dueDate")}<input type="date" value={form.editDueDate || ""} onChange={(e) => setForm({ ...form, editDueDate: e.target.value })} /></label>
              <label>{t("leases.amount")}<input type="number" step="0.01" min="0" value={form.amountInput ?? ""} onChange={(e) => setForm({ ...form, amountInput: e.target.value })} /></label>
              <label>{t("leases.periodFrom")}<input type="date" value={form.editFrom || ""} onChange={(e) => setForm({ ...form, editFrom: e.target.value })} /></label>
              <label>{t("leases.periodTo")}<input type="date" value={form.editTo || ""} onChange={(e) => setForm({ ...form, editTo: e.target.value })} /></label>
              <label style={{ gridColumn: "1 / -1" }}>{t("leases.notes")}<input value={form.noteInput || ""} onChange={(e) => setForm({ ...form, noteInput: e.target.value })} /></label>
            </div>
            {error && <p className="balance-bad">{error}</p>}
            <div className="form-btn-group"><button className="btn-ghost" onClick={() => setForm({ ...form, mode: "view" })}>{t("common.cancel")}</button><button className="btn-ghost" onClick={removePayment}>{t("common.delete")}</button><button className="btn-primary" onClick={savePaymentEdit}>{t("common.save")}</button></div>
          </>
        )}
      </FormDialog>

      <FormDialog open={dialog === "reverse"} title={t("leases.reverseTitle")} onClose={close} style={{ maxWidth: 520 }}>
        <p className="note">{t("leases.reverseNote")}</p>
        <label>{t("leases.reverseReason")}<textarea rows={2} style={{ width: "100%" }} value={form.reason || ""} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group"><button className="btn-ghost" onClick={close}>{t("common.cancel")}</button><button className="btn-primary" onClick={saveReverse}>{t("leases.reverse")}</button></div>
      </FormDialog>

      <FormDialog open={dialog === "removeRun"} title={`${t("leases.amortization.remove")} — ${form.month ? fmtMonth(form.month) : ""}`} onClose={close} style={{ maxWidth: 460 }}>
        <p className="note">{t("leases.amortization.removeNote")}</p>
        <label>{t("leases.amortization.pin")}<input type="password" autoComplete="off" value={form.pin || ""} onChange={(e) => setForm({ ...form, pin: e.target.value })} /></label>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group"><button className="btn-ghost" onClick={close}>{t("common.cancel")}</button><button className="btn-primary" disabled={!form.pin} onClick={() => run(() => api.removeLeaseAmortizationRun(form.id, form.pin), "leases.amortization.removedOk")}>{t("leases.amortization.remove")}</button></div>
      </FormDialog>
    </div>
  );
}
