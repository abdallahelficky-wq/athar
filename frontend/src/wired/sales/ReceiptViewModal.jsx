import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { PrintShell, printWithOrientation } from "../../legacy/shared";
import { fmt2 } from "../../legacy/constants";
import { currencyLabel } from "../../shared/countries";

export default function ReceiptViewModal({ receipt, company, autoPrint, onClose }) {
  const { t, i18n } = useTranslation();
  const currency = currencyLabel(company?.currency, i18n.language);
  useEffect(() => {
    if (!autoPrint) return;
    const timer = setTimeout(() => printWithOrientation(false), 200);
    return () => clearTimeout(timer);
  }, [autoPrint, receipt.id]);
  return (
    <PrintShell company={company} subtitle={t("sales.receipts.voucherTitle")} onClose={onClose}
      refNode={<><div>{t("sales.receipts.listTable.number")}: <strong>{receipt.receiptNumber}</strong></div><div>{t("sales.receipts.date")}: <strong>{receipt.date.slice(0, 10)}</strong></div></>}>
      {receipt.status !== "posted" && <h3>{t("sales.receipts.draftNotice")}</h3>}
      <div className="voucher-meta">
        <div><span>{t("sales.receipts.receivedFrom")}</span><strong>{receipt.customer?.name || "—"}</strong></div>
        <div><span>{t("sales.receipts.method")}</span><strong>{t(receipt.method === "cash" ? "sales.receipts.methodCash" : "sales.receipts.methodBank")}</strong></div>
        {receipt.bankAccount && <div><span>{t("sales.receipts.bankAccount")}</span><strong>{receipt.bankAccount.name}</strong></div>}
        <div><span>{t("sales.receipts.receivedAmount")}</span><strong>{fmt2(Number(receipt.totalAmount))} {currency}</strong></div>
      </div>
      <table className="ledger-table voucher-table">
        <thead><tr><th>{t("sales.receipts.table.invoice")}</th><th>{t("sales.receipts.table.allocated")}</th></tr></thead>
        <tbody>{(receipt.allocations || []).map(a => <tr key={a.invoiceId}><td>{a.invoice?.invoiceNumber || "—"}</td><td className="num">{fmt2(Number(a.amount))} {currency}</td></tr>)}</tbody>
        <tfoot><tr><td>{t("sales.receipts.unapplied")}</td><td className="num">{fmt2(Number(receipt.unappliedAmount || 0))} {currency}</td></tr>
          <tr><td>{t("sales.receipts.listTable.total")}</td><td className="num strong">{fmt2(Number(receipt.totalAmount))} {currency}</td></tr></tfoot>
      </table>
    </PrintShell>
  );
}
