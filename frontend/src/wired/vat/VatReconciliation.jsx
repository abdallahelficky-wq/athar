import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { getVatReturn, getVatReconciliation, exportZatcaArchive } from "../../api/vatReconciliation";
import { downloadBlob } from "../../legacy/shared";
import { fmt } from "../../legacy/constants";
import VatPeriodBar from "../shared/VatPeriodBar";
import { useVatFetch, useVatPeriod } from "../shared/vatPeriod";

const ITEM_KEYS = ["otherSources", "stationShifts", "documentEntryOutsidePeriod", "entryForDocumentOutsidePeriod", "amountMismatch"];
const day = (iso) => (iso ? iso.slice(0, 10) : "—");

function EntryRows({ rows }) {
  const { t } = useTranslation();
  return rows.map((r) => (
    <tr key={r.journalEntryId} className="vat-detail-row">
      <td>
        {r.entryNumber} · {day(r.date)} · {t(`vat.recon.source.${r.sourceModule}`, { defaultValue: r.sourceModule })}
        {r.document && <> · {t(`vat.recon.doc.${r.document.entityType}`)} {r.document.number} ({day(r.document.date)})</>}
        {r.memo && <div className="vat-note">{r.memo}</div>}
      </td>
      <td className="num">{fmt(r.amount)}</td>
    </tr>
  ));
}

function DocRows({ rows }) {
  const { t } = useTranslation();
  return rows.map((r) => (
    <tr key={r.id} className="vat-detail-row">
      <td>
        {t(`vat.recon.doc.${r.entityType}`)} {r.number} · {day(r.date)} · {t("vat.recon.documentVat")} {fmt(r.documentVat)}
        <div className="vat-note">
          {r.reason ? t(`vat.recon.reason.${r.reason}`) : null}
          {r.entryNumber ? ` ${t("vat.recon.entry")} ${r.entryNumber} (${day(r.entryDate)})` : ""}
        </div>
      </td>
      <td className="num">{fmt(r.amount)}</td>
    </tr>
  ));
}

function SideTable({ side, data }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState({});
  const toggle = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  return (
    <div className="panel" data-testid={`vat-recon-${side}`}>
      <h3>{t(`vat.recon.${side}.title`)}</h3>
      {data.account ? (
        <p className="vat-note">{t("vat.recon.account")}: {data.account.code} — {data.account.name}</p>
      ) : (
        <p className="balance-bad">{t("vat.recon.noAccount")}</p>
      )}
      <table className="ledger-table">
        <tbody>
          {Object.entries(data.documentVatByType).map(([type, amount]) => (
            <tr key={type}><td>{t(`vat.recon.doc.${type}`)}</td><td className="num">{fmt(amount)}</td></tr>
          ))}
          <tr className="net-row"><td className="strong">{t("vat.recon.documentVatTotal")} ({data.documentCount})</td><td className="num strong">{fmt(data.documentVat)}</td></tr>
          <tr className="net-row"><td className="strong">{t("vat.recon.ledgerMovement")}</td><td className="num strong">{fmt(data.ledgerMovement)}</td></tr>
          <tr className="net-row"><td className="strong">{t("vat.recon.difference")}</td><td className="num strong">{fmt(data.difference)}</td></tr>
          {ITEM_KEYS.map((k) => {
            const item = data.items[k];
            if (!item.rows.length) return null;
            const isDoc = k === "documentEntryOutsidePeriod" || k === "amountMismatch";
            return (
              <React.Fragment key={k}>
                <tr className="vat-item-row" onClick={() => toggle(k)} style={{ cursor: "pointer" }}>
                  <td>{open[k] ? "▾" : "▸"} {t(`vat.recon.items.${k}`)} ({item.rows.length})</td>
                  <td className="num">{fmt(item.total)}</td>
                </tr>
                {open[k] && (isDoc ? <DocRows rows={item.rows} /> : <EntryRows rows={item.rows} />)}
              </React.Fragment>
            );
          })}
          <tr className="net-row">
            <td className="strong">{t("vat.recon.residual")}</td>
            <td className={"num strong " + (data.residual === 0 ? "balance-ok" : "balance-bad")} data-testid={`vat-recon-${side}-residual`}>
              {fmt(data.residual)}
            </td>
          </tr>
        </tbody>
      </table>
      {data.residual !== 0 && <p className="balance-bad">{t("vat.recon.residualWarning")}</p>}

      <OutsideBothSides data={data.outsideBothSides} />
    </div>
  );
}

/**
 * تصدير أرشيف مستندات زاتكا لنفس الشركة والفترة (الملحق 1: ملفات XML بأسماء الرقم الضريبي وتاريخ ووقت الإصدار ورقم
 * المستند، وmanifest.csv). يعرض بعد التصدير عدد المستندات المحفوظة وعدد المقبولة لدى زاتكا بلا أصل محفوظ.
 */
function ZatcaArchiveExport({ companyId, period }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const run = async () => {
    setBusy(true); setError(""); setResult(null);
    try {
      const { blob, filename, headers } = await exportZatcaArchive({ companyId, from: period.from, to: period.to });
      downloadBlob(blob, filename || `zatca-archive_${period.from}_${period.to}.zip`);
      setResult({ archived: Number(headers?.get("X-Archived-Count") ?? 0), missing: Number(headers?.get("X-Missing-Count") ?? 0) });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel" data-testid="zatca-archive-export">
      <h3>{t("vat.archive.title")}</h3>
      <p className="vat-note">{t("vat.archive.note")}</p>
      <button className="btn-primary" disabled={busy || !companyId} onClick={run}>{t("vat.archive.export", { from: period.from, to: period.to })}</button>
      {error && <p className="balance-bad">{error}</p>}
      {result && (
        <p className={result.missing ? "balance-bad" : "vat-note"}>
          {t("vat.archive.result", { archived: result.archived, missing: result.missing })}
        </p>
      )}
    </div>
  );
}

function OutsideBothSides({ data }) {
  const { t } = useTranslation();
  const { unpostedDocuments, notFullyPosted, savedEntries } = data;
  if (!unpostedDocuments.length && !notFullyPosted.length && !savedEntries.length) return null;
  return (
    <>
      <h4>{t("vat.recon.outside.title")}</h4>
      <p className="vat-note">{t("vat.recon.outside.note")}</p>
      <table className="ledger-table">
        <tbody>
          {unpostedDocuments.length > 0 && <tr className="vat-item-row"><td colSpan={2}>{t("vat.recon.outside.unposted")} ({unpostedDocuments.length})</td></tr>}
          {unpostedDocuments.map((d) => (
            <tr key={d.id} className="vat-detail-row">
              <td>
                {t(`vat.recon.doc.${d.entityType}`)} {d.number} · {day(d.date)}
                <div className="vat-note">
                  {t("vat.recon.outside.unpostedAt", { at: day(d.unpostedAt), by: d.unpostedBy || "—" })}
                  {" · "}
                  {d.current
                    ? t("vat.recon.outside.currentState", { status: d.current.status, date: day(d.current.date), vat: fmt(d.current.documentVat) })
                    : t("vat.recon.outside.deletedSince")}
                  {d.current?.zatcaStatus && d.current.zatcaStatus !== "not_applicable" ? ` · ZATCA: ${d.current.zatcaStatus}` : ""}
                </div>
              </td>
              <td className="num">{fmt(d.documentVat)}</td>
            </tr>
          ))}
          {notFullyPosted.length > 0 && <tr className="vat-item-row"><td colSpan={2}>{t("vat.recon.outside.notFullyPosted")} ({notFullyPosted.length})</td></tr>}
          {notFullyPosted.map((d) => (
            <tr key={d.id} className="vat-detail-row">
              <td>{t(`vat.recon.doc.${d.entityType}`)} {d.number} · {day(d.date)}<div className="vat-note">{d.status} · ZATCA: {d.zatcaStatus}</div></td>
              <td className="num">{fmt(d.documentVat)}</td>
            </tr>
          ))}
          {savedEntries.length > 0 && <tr className="vat-item-row"><td colSpan={2}>{t("vat.recon.outside.saved")} ({savedEntries.length})</td></tr>}
          {savedEntries.length > 0 && <EntryRows rows={savedEntries} />}
        </tbody>
      </table>
    </>
  );
}

/** مسودة الإقرار حسب فئة الضريبة على السطر — للمراجعة قبل التقديم في منصة الهيئة (vatReturn.service.ts) */
function VatReturnDraft({ companyId, period }) {
  const { t } = useTranslation();
  const { data, error } = useVatFetch(getVatReturn, companyId, period);
  if (error) return <div className="panel"><p className="balance-bad">{error}</p></div>;
  if (!data) return null;
  const rows = [["S", "standard"], ["Z", "zero"], ["E", "exempt"], ["O", "outOfScope"]];
  const side = (key, block) => <>
    <tr><td className="strong section-row" colSpan={5}>{t(`vat.return.${key}`)}</td></tr>
    {rows.map(([c, label]) => <tr key={c}>
      <td>{t(`vat.return.categories.${label}`)}</td>
      <td className="num">{fmt(block[c].base)}</td><td className="num">{fmt(block[c].adjustmentBase)}</td>
      <td className="num strong">{fmt(block[c].netBase)}</td><td className="num strong">{fmt(block[c].netVat)}</td>
    </tr>)}
  </>;
  return <div className="panel" data-testid="vat-return-draft">
    <h3>{t("vat.return.title")}</h3>
    <p style={{ fontSize: 12 }}>{t("vat.return.note")}</p>
    <table className="ledger-table">
      <thead><tr><th>{t("vat.return.category")}</th><th>{t("vat.return.amount")}</th><th>{t("vat.return.adjustments")}</th><th>{t("vat.return.netAmount")}</th><th>{t("vat.return.vat")}</th></tr></thead>
      <tbody>
        {side("sales", data.sales)}
        {data.stationShiftCount > 0 && <tr><td>{t("vat.return.stationShifts", { count: data.stationShiftCount })}</td><td /><td /><td /><td className="num strong">{fmt(data.stationShiftVat)}</td></tr>}
        <tr><td className="strong">{t("vat.return.totalOutput")}</td><td /><td /><td className="num strong">{fmt(data.totalSalesBase)}</td><td className="num strong">{fmt(data.totalOutputVat)}</td></tr>
        {side("purchases", data.purchases)}
        <tr><td className="strong">{t("vat.return.totalInput")}</td><td /><td /><td className="num strong">{fmt(data.totalPurchasesBase)}</td><td className="num strong">{fmt(data.totalInputVat)}</td></tr>
        <tr className="net-row"><td className="strong">{t("vat.return.net")}</td><td /><td /><td /><td className={"num strong " + (data.netVat < 0 ? "balance-ok" : "")}>{fmt(data.netVat)}</td></tr>
      </tbody>
    </table>
  </div>;
}

/**
 * مطابقة الضريبة لشركة واحدة وفترة إقرار واحدة: ضريبة المستندات مقابل حركة حسابَي الضريبة، والفرق
 * مفصَّلاً. هذه الأرقام هي ما يُوقَّع عليه الإقرار، فلا يُعرَض شيء بلا شركة وفترة صريحتين.
 */
export default function VatReconciliation({ companyId, companies }) {
  const { t } = useTranslation();
  const period = useVatPeriod(companies?.find((c) => c.id === companyId));
  const { data, error } = useVatFetch(getVatReconciliation, companyId, period.applied);

  return (
    <div>
      <div className="panel">
        <VatPeriodBar title={t("nav.tabs.vatReconciliation")} period={period} />
        {error && <p className="balance-bad">{error}</p>}
        {data && (
          <table className="ledger-table">
            <tbody>
              <tr><td>{t("vat.recon.netPerDocuments")}</td><td className="num strong">{fmt(data.netVatPerDocuments)}</td></tr>
              <tr><td>{t("vat.recon.netPerLedger")}</td><td className="num strong">{fmt(data.netVatPerLedger)}</td></tr>
            </tbody>
          </table>
        )}
      </div>
      {data && (
        <>
          <SideTable side="output" data={data.output} />
          <SideTable side="input" data={data.input} />
          {data.otherVatNamedAccounts.length > 0 && (
            <div className="panel" data-testid="vat-recon-other-accounts">
              <h3>{t("vat.recon.otherAccounts.title")}</h3>
              <p className="balance-bad">{t("vat.recon.otherAccounts.note")}</p>
              <table className="ledger-table">
                <thead><tr><th>{t("vat.recon.account")}</th><th>{t("vat.recon.otherAccounts.debit")}</th><th>{t("vat.recon.otherAccounts.credit")}</th></tr></thead>
                <tbody>
                  {data.otherVatNamedAccounts.map((a) => (
                    <tr key={a.id}><td>{a.code} — {a.name}</td><td className="num">{fmt(a.debit)}</td><td className="num">{fmt(a.credit)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {companyId && <VatReturnDraft companyId={companyId} period={period.applied} />}
      <ZatcaArchiveExport companyId={companyId} period={period.applied} />
    </div>
  );
}
