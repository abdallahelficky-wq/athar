import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listJournalEntries } from "../../api/journalEntries";
import { fmt } from "../../legacy/constants";
import StatusPill from "../shared/StatusPill";

const RECENT_COUNT = 6;

/**
 * "أحدث القيود اليومية" — بيانات مختلفة فعلياً عن RecentActivity (حركات كاش بالاتجاه فقط):
 * هنا رقم القيد وحالته (محفوظ/مرحّل) لكل قيد بصرف النظر عن كونه نقدياً أصلاً، عبر نفس
 * /api/journal-entries المستخدَم في شاشة دفتر اليومية (بلا أي إضافة/تعديل على الخادم) — تُقتصَر
 * على آخر RECENT_COUNT قيد فقط بعد الجلب (القائمة تصل مُرتَّبة الأحدث أولاً أصلاً من الخادم).
 */
export default function RecentEntriesTable({ companyId, range }) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState(null);

  useEffect(() => {
    if (!range) return;
    setEntries(null);
    listJournalEntries({ companyId, dateFrom: range.dateFrom, dateTo: range.dateTo })
      .then((rows) => setEntries(rows.slice(0, RECENT_COUNT)))
      .catch(() => setEntries([]));
  }, [companyId, range]);

  if (entries == null) return <p className="empty">{t("common.loading")}</p>;
  if (entries.length === 0) return <p className="empty">{t("dashboard.recentEntries.empty")}</p>;

  return (
    <table className="ledger-table">
      <thead>
        <tr>
          <th>{t("dashboard.recentEntries.table.number")}</th>
          <th>{t("dashboard.recentEntries.table.date")}</th>
          <th>{t("dashboard.recentEntries.table.memo")}</th>
          <th>{t("dashboard.recentEntries.table.total")}</th>
          <th>{t("dashboard.recentEntries.table.status")}</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => {
          const total = e.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
          return (
            <tr key={e.id}>
              <td>{e.entryNumber || e.id.slice(-8)}</td>
              <td>{e.date.slice(0, 10)}</td>
              <td>{e.memo || t("journalEntries.table.noMemo")}</td>
              <td className="num">{fmt(total)}</td>
              <td>
                <StatusPill tone={e.status === "posted" ? "success" : "warning"}>
                  {e.status === "posted" ? t("journalEntries.statusPosted") : t("journalEntries.statusSaved")}
                </StatusPill>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
