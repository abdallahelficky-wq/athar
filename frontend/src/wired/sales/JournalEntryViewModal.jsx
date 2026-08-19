import React, { useEffect, useState } from "react";
import { getJournalEntry } from "../../api/journalEntries";
import { fmt } from "../../legacy/constants";

/** يعرض القيد المحاسبي الذي أنشأته فاتورة مبيعات مرحّلة (للقراءة فقط) */
export default function JournalEntryViewModal({ journalEntryId, onClose }) {
  const [entry, setEntry] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getJournalEntry(journalEntryId).then(setEntry).catch((e) => setError(e.message));
  }, [journalEntryId]);

  const total = entry ? entry.lines.reduce((s, l) => s + Number(l.debit), 0) : 0;

  return (
    <div className="invoice-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="invoice-modal-box" style={{ maxWidth: 640 }}>
        <div className="modal-title-row">
          <h3>القيد المحاسبي للفاتورة</h3>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="إغلاق">×</button>
        </div>
        {error && <p className="balance-bad">{error}</p>}
        {!entry && !error && <p className="empty">جارٍ التحميل...</p>}
        {entry && (
          <>
            <div className="voucher-meta">
              <div><span>البيان</span><strong>{entry.memo || "بدون بيان"}</strong></div>
              <div><span>التاريخ</span><strong>{entry.date.slice(0, 10)}</strong></div>
            </div>
            <table className="ledger-table voucher-table">
              <thead><tr><th>الحساب</th><th>القسم</th><th>مدين</th><th>دائن</th></tr></thead>
              <tbody>
                {entry.lines.map((l) => (
                  <tr key={l.id}>
                    <td>{l.account?.name}</td>
                    <td>{l.departmentRef?.name || l.department || "—"}</td>
                    <td className="num">{Number(l.debit) ? fmt(Number(l.debit)) : "—"}</td>
                    <td className="num">{Number(l.credit) ? fmt(Number(l.credit)) : "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="foot-label" colSpan={2}>الإجمالي</td>
                  <td className="num strong">{fmt(total)}</td>
                  <td className="num strong">{fmt(total)}</td>
                </tr>
              </tfoot>
            </table>
          </>
        )}
        <div className="form-btn-group" style={{ marginTop: 16 }}>
          <button className="btn-ghost" onClick={onClose}>إغلاق</button>
        </div>
      </div>
    </div>
  );
}
