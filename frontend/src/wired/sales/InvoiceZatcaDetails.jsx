import React from "react";
import { useTranslation } from "react-i18next";
import { invoiceZatcaState } from "./invoiceZatcaState";
export default function InvoiceZatcaDetails({ invoice }) {
  const { t } = useTranslation();
  const state = invoiceZatcaState(invoice);
  return <section className="no-print" style={{ padding: 16, marginBottom: 16, border: "1px solid #ddd", borderRadius: 8 }}>
    <strong>{t("salesInvoices.table.zatcaStatus")}: </strong>
    <span className={state.className}>{t(`salesInvoices.zatcaSummary.${state.key}`)}</span>
    {state.key === "not_sent" && <p>{t(`salesInvoices.zatcaStatus.${state.status}`, { defaultValue: t("salesInvoices.zatcaSummary.not_sent") })}</p>}
    {[["notes", state.warnings], ["errors", state.errors]].map(([kind, entries]) => entries.length > 0 && <div key={kind}>
      <h4>{t(`salesInvoices.zatcaSummary.${kind}`)}</h4>
      <ul>{entries.map((entry, index) => <li key={index} style={{ overflowWrap: "anywhere" }}>
        {entry.code && <bdi>{entry.code}: </bdi>}<span dir="auto">{entry.message}</span>
      </li>)}</ul>
    </div>)}
  </section>;
}
