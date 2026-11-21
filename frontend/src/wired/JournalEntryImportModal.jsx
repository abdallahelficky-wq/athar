import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listJournalEntriesPage, getJournalEntry } from "../api/journalEntries";
import { fmt2 } from "../legacy/constants";

/**
 * نافذة «استيراد من قيد»: بحث في قيود الشركة الحالية فقط (companyId يُرسَل دائماً، والخادم يطبّق نطاق
 * المستأجر/الشركة من التوكن) برقم القيد أو بيانه، ثم اختيار قيد لجلب تفاصيله الكاملة عبر getJournalEntry
 * وتسليمها لـonPick. لا تكتب شيئاً في الخادم.
 */
export default function JournalEntryImportModal({ companyId, onPick, onClose }) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState("");
  const [error, setError] = useState("");
  const reqRef = useRef(0);

  useEffect(() => {
    const term = q.trim();
    const id = ++reqRef.current;
    setLoading(true);
    setError("");
    const timer = setTimeout(async () => {
      try {
        const base = { companyId, take: 20 };
        // الرقم يُبحث عنه بحقل رقم القيد، والنص بحقل البيان؛ ندمج النتيجتين بلا تكرار.
        const calls = term
          ? [listJournalEntriesPage({ ...base, search: term }), listJournalEntriesPage({ ...base, entryNumber: term })]
          : [listJournalEntriesPage(base)];
        const settled = await Promise.allSettled(calls);
        if (id !== reqRef.current) return;
        const ok = settled.filter((s) => s.status === "fulfilled");
        if (!ok.length) throw settled[0].reason;
        const seen = new Set();
        const merged = [];
        ok.forEach((s) => (s.value?.items || []).forEach((e) => { if (!seen.has(e.id)) { seen.add(e.id); merged.push(e); } }));
        setItems(merged);
      } catch (err) {
        if (id === reqRef.current) { setItems([]); setError(err.message || t("journalEntries.form.importFailed")); }
      } finally {
        if (id === reqRef.current) setLoading(false);
      }
    }, term ? 350 : 0);
    return () => clearTimeout(timer);
  }, [q, companyId, t]);

  const pick = async (entry) => {
    if (picking) return;
    setPicking(entry.id);
    setError("");
    try {
      onPick(await getJournalEntry(entry.id));
    } catch (err) {
      setError(err.message || t("journalEntries.form.importFailed"));
      setPicking("");
    }
  };

  return (
    <div className="jf-import-overlay" onClick={(e) => e.target === e.currentTarget && !picking && onClose()}>
      <div className="jf-import-box" role="dialog" aria-modal="true">
        <div className="modal-title-row">
          <h3>{t("journalEntries.form.importTitle")}</h3>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t("journalEntries.form.close")}>×</button>
        </div>
        <div className="jf-import-body">
          <input
            type="text" autoFocus value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={t("journalEntries.form.importSearchPlaceholder")}
          />
          <p className="jf-import-hint">{t("journalEntries.form.importHint")}</p>
          {error && <p className="balance-bad">{error}</p>}
          <ul className="jf-import-list">
            {items.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => pick(e)} disabled={!!picking}>
                  <span className="jf-import-no">{e.entryNumber || e.id.slice(-8)}</span>
                  <span className="jf-import-memo">{e.memo || "—"}</span>
                  <span className="jf-import-date">{String(e.date).slice(0, 10)}</span>
                  <span className="jf-import-amt">{fmt2(Number(e.totalDebit) || 0)}</span>
                </button>
              </li>
            ))}
            {!loading && !error && items.length === 0 && <li className="jf-import-empty">{t("journalEntries.form.importNoResults")}</li>}
            {loading && <li className="jf-import-empty">{t("journalEntries.form.importLoading")}</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
