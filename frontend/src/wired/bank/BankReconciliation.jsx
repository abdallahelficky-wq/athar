import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { loadXlsx } from "../shared/loadXlsx";
import { listAccounts } from "../../api/accounts";
import {
  listBankStatements, createBankStatement, getBankStatement, autoMatchBankStatement,
  matchBankLine, unmatchBankLine, reconcileBankStatement, reopenBankStatement, deleteBankStatement,
} from "../../api/bankReconciliation";
import { fmt2 } from "../../legacy/constants";
import FormDialog from "../shared/FormDialog";
import { buildStatementLines, guessColumns, guessHeaderRow, summarizeLines } from "./bankStatementParse";

/**
 * التسوية البنكية: اختيار حساب البنك ← رفع كشف (Excel/CSV) وتحديد أعمدته ← مطابقة تلقائية ثم يدوية مع حركة الحساب في
 * الدفاتر ← ملخص التسوية والفرق ← «تسوية» تجمّد الكشف. المنطق والتحقق في الخادم (bankReconciliation.service.ts).
 */
const day = (iso) => (iso ? String(iso).slice(0, 10) : "—");
const money = (v) => fmt2(Number(v || 0));

export default function BankReconciliation({ companyId }) {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState("");
  const [statements, setStatements] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!companyId) return;
    listAccounts({ companyId, includePartyAccounts: false })
      .then((rows) => {
        const banks = (rows || []).filter((a) => a.isBankOrCash && a.isPosting && !a.isArchived);
        setAccounts(banks);
        setAccountId((cur) => (banks.some((a) => a.id === cur) ? cur : banks[0]?.id || ""));
      })
      .catch((e) => setError(e.message));
  }, [companyId]);

  const reload = useCallback(() => {
    if (!companyId || !accountId) { setStatements([]); return; }
    listBankStatements({ companyId, accountId }).then(setStatements).catch((e) => setError(e.message));
  }, [companyId, accountId]);
  useEffect(reload, [reload]);

  if (openId) return <StatementView id={openId} onBack={() => { setOpenId(null); reload(); }} />;

  return (
    <div className="panel" data-testid="bank-reconciliation">
      <div className="modal-title-row">
        <h3 style={{ margin: 0 }}>{t("bankRec.title")}</h3>
        <button className="btn-primary" disabled={!accountId} onClick={() => setUploadOpen(true)}>{t("bankRec.upload")}</button>
      </div>
      <p className="vat-note">{t("bankRec.intro")}</p>
      {error && <p className="balance-bad">{error}</p>}
      <label>
        {t("bankRec.account")}{" "}
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {accounts.length === 0 && <option value="">{t("bankRec.noBankAccounts")}</option>}
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
        </select>
      </label>
      <table className="ledger-table" style={{ marginTop: 12 }}>
        <thead>
          <tr>
            <th>{t("bankRec.period")}</th><th>{t("bankRec.file")}</th><th>{t("bankRec.lines")}</th>
            <th>{t("bankRec.unmatched")}</th><th>{t("bankRec.closing")}</th><th>{t("bankRec.status")}</th>
          </tr>
        </thead>
        <tbody>
          {statements.length === 0 && <tr><td colSpan={6} className="vat-note">{t("bankRec.empty")}</td></tr>}
          {statements.map((s) => (
            <tr key={s.id} style={{ cursor: "pointer" }} onClick={() => setOpenId(s.id)}>
              <td>{day(s.periodStart)} — {day(s.periodEnd)}</td>
              <td>{s.fileName || "—"}</td>
              <td className="num">{s.lineCount}</td>
              <td className={"num " + (s.unmatchedCount ? "balance-bad" : "balance-ok")}>{s.unmatchedCount}</td>
              <td className="num">{money(s.closingBalance)}</td>
              <td>{t(`bankRec.state.${s.status}`)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <UploadDialog
        open={uploadOpen}
        companyId={companyId}
        accountId={accountId}
        lastClosing={statements[0]?.closingBalance}
        onClose={() => setUploadOpen(false)}
        onCreated={(st) => { setUploadOpen(false); setOpenId(st.id); }}
      />
    </div>
  );
}

function UploadDialog({ open, companyId, accountId, lastClosing, onClose, onCreated }) {
  const { t } = useTranslation();
  const [fileName, setFileName] = useState("");
  const [matrix, setMatrix] = useState([]);
  const [mapping, setMapping] = useState({ headerRow: 0 });
  const [opening, setOpening] = useState("");
  const [closing, setClosing] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) { setFileName(""); setMatrix([]); setMapping({ headerRow: 0 }); setError(""); setClosing(""); }
    else setOpening(lastClosing !== undefined && lastClosing !== null ? String(Number(lastClosing)) : "0");
  }, [open, lastClosing]);

  const onFile = async (file) => {
    setError("");
    if (!file) return;
    try {
      const XLSX = await loadXlsx();
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", raw: true });
      const headerRow = guessHeaderRow(rows);
      const cols = guessColumns(rows[headerRow]);
      setFileName(file.name);
      setMatrix(rows);
      setMapping({ headerRow, amountSign: "depositPositive", ...cols, amount: cols.debit !== undefined || cols.credit !== undefined ? undefined : cols.amount });
    } catch (e) {
      setError(t("bankRec.readError"));
    }
  };

  const header = matrix[mapping.headerRow] || [];
  const parsed = useMemo(() => (matrix.length && mapping.date !== undefined ? buildStatementLines(matrix, mapping) : { lines: [], skipped: 0, errors: [] }), [matrix, mapping]);
  const summary = summarizeLines(parsed.lines);
  const computedClosing = Math.round((Number(opening || 0) + summary.movement) * 100) / 100;
  useEffect(() => { if (parsed.lines.length) setClosing(String(computedClosing)); }, [computedClosing, parsed.lines.length]);

  const colSelect = (key, optional = true) => (
    <label key={key} style={{ display: "inline-block", marginInlineEnd: 12 }}>
      {t(`bankRec.col.${key}`)}{" "}
      <select value={mapping[key] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [key]: e.target.value === "" ? undefined : Number(e.target.value) }))}>
        {optional && <option value="">—</option>}
        {header.map((h, i) => <option key={i} value={i}>{String(h || `${t("bankRec.column")} ${i + 1}`)}</option>)}
      </select>
    </label>
  );

  const submit = async () => {
    setBusy(true); setError("");
    try {
      const st = await createBankStatement({
        companyId, accountId, fileName,
        periodStart: summary.periodStart, periodEnd: summary.periodEnd,
        openingBalance: Number(opening || 0), closingBalance: Number(closing || 0),
        lines: parsed.lines,
      });
      onCreated(st);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormDialog open={open} title={t("bankRec.upload")} onClose={onClose}>
      <p className="vat-note">{t("bankRec.uploadNote")}</p>
      <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => onFile(e.target.files?.[0])} />
      {matrix.length > 0 && (
        <>
          <div style={{ marginTop: 12 }}>
            <label style={{ display: "inline-block", marginInlineEnd: 12 }}>
              {t("bankRec.headerRow")}{" "}
              <select value={mapping.headerRow} onChange={(e) => setMapping((m) => ({ ...m, headerRow: Number(e.target.value) }))}>
                {matrix.slice(0, 40).map((r, i) => <option key={i} value={i}>{i + 1}: {r.filter(Boolean).slice(0, 4).join(" | ")}</option>)}
              </select>
            </label>
          </div>
          <div style={{ marginTop: 8 }}>
            {colSelect("date", false)}{colSelect("description")}{colSelect("reference")}
          </div>
          <div style={{ marginTop: 8 }}>
            {colSelect("debit")}{colSelect("credit")}
            <span className="vat-note"> {t("bankRec.or")} </span>
            {colSelect("amount")}
            {mapping.amount !== undefined && (
              <select value={mapping.amountSign} onChange={(e) => setMapping((m) => ({ ...m, amountSign: e.target.value }))}>
                <option value="depositPositive">{t("bankRec.sign.depositPositive")}</option>
                <option value="withdrawalPositive">{t("bankRec.sign.withdrawalPositive")}</option>
              </select>
            )}
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={{ marginInlineEnd: 12 }}>{t("bankRec.opening")} <input type="number" step="0.01" value={opening} onChange={(e) => setOpening(e.target.value)} /></label>
            <label>{t("bankRec.closing")} <input type="number" step="0.01" value={closing} onChange={(e) => setClosing(e.target.value)} /></label>
          </div>
          <p className="vat-note">
            {t("bankRec.preview", { count: parsed.lines.length, skipped: parsed.skipped, from: summary.periodStart || "—", to: summary.periodEnd || "—", movement: money(summary.movement) })}
          </p>
          {parsed.errors.length > 0 && <p className="balance-bad">{t("bankRec.parseErrors", { rows: parsed.errors.map((x) => x.row).join(", ") })}</p>}
          <table className="ledger-table">
            <tbody>
              {parsed.lines.slice(0, 8).map((l, i) => (
                <tr key={i}><td>{l.date}</td><td>{l.description}</td><td>{l.reference}</td><td className={"num " + (l.amount < 0 ? "balance-bad" : "balance-ok")}>{money(l.amount)}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {error && <p className="balance-bad">{error}</p>}
      <div style={{ marginTop: 12 }}>
        <button className="btn-primary" disabled={busy || !parsed.lines.length || parsed.errors.length > 0} onClick={submit}>{t("bankRec.save")}</button>
      </div>
    </FormDialog>
  );
}

function StatementView({ id, onBack }) {
  const { t } = useTranslation();
  const [st, setSt] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => getBankStatement(id).then(setSt).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn) => {
    setBusy(true); setError("");
    try {
      const result = await fn();
      if (result && result.lines) setSt(result);
      else if (result && result.statement) setSt(result.statement);
      else await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!st) return <div className="panel">{error ? <p className="balance-bad">{error}</p> : t("common.loading", { defaultValue: "..." })}</div>;
  const s = st.summary;
  const locked = st.status === "reconciled";
  const selectedLine = st.lines.find((l) => l.id === selected);
  const candidates = selectedLine
    ? st.outstandingBookLines.filter((b) => Math.round(b.amount * 100) === Math.round(Number(selectedLine.amount) * 100))
    : st.outstandingBookLines;

  return (
    <div data-testid="bank-statement-view">
      <div className="panel">
        <div className="modal-title-row">
          <h3 style={{ margin: 0 }}>{st.account.code} — {st.account.name} · {day(st.periodStart)} — {day(st.periodEnd)}</h3>
          <button className="btn-secondary" onClick={onBack}>{t("bankRec.back")}</button>
        </div>
        <table className="ledger-table">
          <tbody>
            <tr><td>{t("bankRec.sum.bookBalance")}</td><td className="num">{money(s.bookBalance)}</td></tr>
            <tr><td>{t("bankRec.sum.unmatchedBook", { count: s.unmatchedBookCount })}</td><td className="num">{money(-s.unmatchedBookTotal)}</td></tr>
            <tr><td>{t("bankRec.sum.unmatchedBank", { count: s.unmatchedBankCount })}</td><td className="num">{money(s.unmatchedBankTotal)}</td></tr>
            <tr className="net-row"><td className="strong">{t("bankRec.sum.computed")}</td><td className="num strong">{money(s.computedClosingBalance)}</td></tr>
            <tr className="net-row"><td className="strong">{t("bankRec.sum.statement")}</td><td className="num strong">{money(s.statementClosingBalance)}</td></tr>
            <tr className="net-row"><td className="strong">{t("bankRec.sum.difference")}</td><td className={"num strong " + (s.difference === 0 ? "balance-ok" : "balance-bad")}>{money(s.difference)}</td></tr>
          </tbody>
        </table>
        {error && <p className="balance-bad">{error}</p>}
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          {!locked && <button className="btn-secondary" disabled={busy} onClick={() => run(() => autoMatchBankStatement(id))}>{t("bankRec.autoMatch")}</button>}
          {!locked && <button className="btn-primary" disabled={busy || !s.canReconcile} onClick={() => run(() => reconcileBankStatement(id))}>{t("bankRec.reconcile")}</button>}
          {locked && <span className="balance-ok strong">{t("bankRec.reconciledAt", { at: day(st.reconciledAt) })}</span>}
          {locked && <button className="btn-secondary" disabled={busy} onClick={() => run(() => reopenBankStatement(id))}>{t("bankRec.reopen")}</button>}
          {!locked && (
            <button className="btn-ghost" disabled={busy} onClick={() => { if (window.confirm(t("bankRec.deleteConfirm"))) run(async () => { await deleteBankStatement(id); onBack(); return null; }); }}>
              {t("bankRec.delete")}
            </button>
          )}
        </div>
        {!locked && !s.canReconcile && s.unmatchedBankCount > 0 && <p className="vat-note">{t("bankRec.hintUnmatchedBank")}</p>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 12 }}>
        <div className="panel">
          <h4>{t("bankRec.bankLines")}</h4>
          <table className="ledger-table">
            <thead><tr><th>{t("bankRec.col.date")}</th><th>{t("bankRec.col.description")}</th><th>{t("bankRec.amount")}</th><th>{t("bankRec.match")}</th></tr></thead>
            <tbody>
              {st.lines.map((l) => {
                const m = l.journalEntryLine;
                return (
                  <tr key={l.id} style={{ background: selected === l.id ? "var(--accent-soft, rgba(0,128,255,.08))" : undefined }}>
                    <td>{day(l.date)}</td>
                    <td>{l.description}{l.reference ? <div className="vat-note">{l.reference}</div> : null}</td>
                    <td className={"num " + (Number(l.amount) < 0 ? "balance-bad" : "balance-ok")}>{money(l.amount)}</td>
                    <td>
                      {m ? (
                        <>
                          <span className="balance-ok">✓ {m.journalEntry.entryNumber}</span>
                          <span className="vat-note"> ({t(`bankRec.matchType.${l.matchType}`)})</span>
                          {!locked && <button className="btn-ghost" disabled={busy} onClick={() => run(() => unmatchBankLine(id, l.id))}>{t("bankRec.unmatch")}</button>}
                        </>
                      ) : !locked ? (
                        <button className="btn-ghost" onClick={() => setSelected(selected === l.id ? null : l.id)}>
                          {selected === l.id ? t("bankRec.cancelSelect") : t("bankRec.selectToMatch")}
                        </button>
                      ) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h4>{selectedLine ? t("bankRec.candidatesFor", { amount: money(selectedLine.amount) }) : t("bankRec.bookLines")}</h4>
          <p className="vat-note">{t("bankRec.bookLinesNote")}</p>
          <table className="ledger-table">
            <thead><tr><th>{t("bankRec.col.date")}</th><th>{t("bankRec.entry")}</th><th>{t("bankRec.amount")}</th><th /></tr></thead>
            <tbody>
              {candidates.length === 0 && <tr><td colSpan={4} className="vat-note">{selectedLine ? t("bankRec.noCandidates") : t("bankRec.noOutstanding")}</td></tr>}
              {candidates.map((b) => (
                <tr key={b.id}>
                  <td>{day(b.journalEntry.date)}</td>
                  <td>{b.journalEntry.entryNumber}<div className="vat-note">{b.description || b.journalEntry.memo}</div></td>
                  <td className={"num " + (b.amount < 0 ? "balance-bad" : "balance-ok")}>{money(b.amount)}</td>
                  <td>
                    {selectedLine && !locked && (
                      <button className="btn-ghost" disabled={busy} onClick={() => run(async () => { const r = await matchBankLine(id, selectedLine.id, b.id); setSelected(null); return r; })}>
                        {t("bankRec.matchThis")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
