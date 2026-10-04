import React from "react";
import { useTranslation } from "react-i18next";
import { PrintShell } from "../legacy/shared";
import AccountLedgerDocument from "./AccountLedgerDocument";
export default function AccountLedgerPrintModal({ ledger, companyId, companies, dateFrom, dateTo, onClose, onDownload }) {
  const { t } = useTranslation();
  const company = companies?.find(c => c.id === companyId);
  const periodLabel = dateFrom || dateTo ? t("reports.trialPrint.periodWithDates", {from: dateFrom || t("reports.trialPrint.periodDefaultFrom"), to: dateTo || t("reports.trialPrint.periodDefaultTo")}) : t("reports.trialPrint.periodAllTime");
  return <PrintShell company={company} hideHeader showSignatures={false} onClose={onClose} onDownload={onDownload}>
    <AccountLedgerDocument ledger={ledger} company={company} periodLabel={periodLabel} printable />
  </PrintShell>;
}
