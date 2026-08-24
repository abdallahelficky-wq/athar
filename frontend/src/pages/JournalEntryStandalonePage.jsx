import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getJournalEntry } from "../api/journalEntries";
import { listCompanies } from "../api/companies";
import JournalVoucherViewModal from "../wired/JournalVoucherViewModal";

/**
 * صفحة مستقلة (بلا هيكل التطبيق المعتاد: بلا شريط جانبي/هيدر) لعرض قيد واحد بتنسيق الطباعة —
 * الوجهة التي تفتحها روابط "<a target=_blank>" من كشف حساب الأستاذ، فيبقى كشف الحساب مفتوحاً في
 * تبويبه الأصلي بينما تفاصيل القيد تُعرَض في تبويب جديد مستقل. تعتمد على نفس جلسة تسجيل الدخول
 * (localStorage مشترك بين تبويبات نفس المتصفح لنفس الأصل) بلا أي شاشة دخول منفصلة.
 */
export default function JournalEntryStandalonePage() {
  const { t } = useTranslation();
  const { id: entryId } = useParams();
  const { isAuthenticated, initializing } = useAuth();
  const [entry, setEntry] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (initializing || !isAuthenticated) return;
    setLoading(true);
    Promise.all([getJournalEntry(entryId), listCompanies()])
      .then(([e, c]) => { setEntry(e); setCompanies(c); })
      .catch(() => setError(t("journalEntries.standalone.notFound")))
      .finally(() => setLoading(false));
  }, [entryId, isAuthenticated, initializing, t]);

  if (initializing) return null;

  if (!isAuthenticated) {
    return (
      <div className="standalone-page-message">
        <p>{t("journalEntries.standalone.loginRequired")}</p>
        <a className="btn-primary" href="/">{t("journalEntries.standalone.loginLink")}</a>
      </div>
    );
  }

  if (loading) {
    return <div className="standalone-page-message"><p>{t("journalEntries.standalone.loading")}</p></div>;
  }

  if (error || !entry) {
    return <div className="standalone-page-message"><p className="balance-bad">{error || t("journalEntries.standalone.notFound")}</p></div>;
  }

  return (
    <JournalVoucherViewModal
      entry={entry}
      companies={companies}
      onClose={() => window.close()}
    />
  );
}
