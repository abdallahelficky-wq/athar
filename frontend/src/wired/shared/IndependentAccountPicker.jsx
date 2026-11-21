import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listOwnAccounts } from "../../api/auth";
import { useAuth } from "../../context/AuthContext";
import { useAnyUnsavedChanges } from "./UnsavedChangesContext";

export default function IndependentAccountPicker() {
  const { i18n } = useTranslation();
  const ar = i18n.language.startsWith("ar");
  const { user, switchAccount } = useAuth();
  const hasUnsaved = useAnyUnsavedChanges();
  const [accounts, setAccounts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    listOwnAccounts().then(rows => { if (alive) setAccounts(rows); })
      .catch(() => { if (alive) setError(ar ? "تعذّر تحميل المنشآت" : "Could not load your companies"); });
    return () => { alive = false; };
  }, [user?.id, ar]);
  async function changeAccount(id) {
    if (!id || id === user?.id || busy) return;
    if (hasUnsaved) {
      setError(ar ? "احفظ التغييرات أو ألغها قبل تغيير المنشأة" : "Save or discard your changes before switching companies");
      return;
    }
    setBusy(true); setError("");
    try {
      await switchAccount(id);
      // A document replacement drops component state, requests and the old page history entry.
      window.location.replace("/dashboard");
    } catch (err) { setError(err.message); setBusy(false); }
  }
  if (!error && accounts.length < 2) return null;
  return <div className="user-menu-switch">
    {accounts.length > 1 && <label>
      <span className="user-menu-switch-label">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 21h18" /><path d="M5 21V7l7-4 7 4v14" /><path d="M9 21v-6h6v6" /></svg>
        {ar ? "تغيير المنشأة" : "Switch company"}
      </span>
      <select aria-label={ar ? "المنشآت" : "Companies"}
        value={user?.id || ""} disabled={busy} onChange={e => changeAccount(e.target.value)}>
        {accounts.map(a => <option key={a.userId} value={a.userId} disabled={a.suspended}>
          {a.name} — ID {a.code}{a.suspended ? (ar ? " (معلّقة)" : " (suspended)") : ""}
        </option>)}
      </select>
    </label>}
    {busy && <span className="user-menu-switch-note" role="status">{ar ? "جارٍ التبديل…" : "Switching…"}</span>}
    {error && <p className="user-menu-switch-error" role="alert">{error}</p>}
  </div>;
}
