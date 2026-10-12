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
      .catch(() => { if (alive) setError(ar ? "تعذّر تحميل الشركات المستقلة" : "Could not load independent companies"); });
    return () => { alive = false; };
  }, [user?.id, ar]);
  async function changeAccount(id) {
    if (!id || id === user?.id || busy) return;
    if (hasUnsaved) {
      setError(ar ? "احفظ التغييرات أو ألغها قبل الانتقال لشركة أخرى" : "Save or discard your changes before switching companies");
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
  return <div style={{ padding: "10px 14px", borderTop: "1px solid #e5e7eb" }}>
    {accounts.length > 1 && <label style={{ display: "grid", gap: 6 }}>
      {ar ? "الانتقال لشركة مستقلة" : "Switch independent company"}
      <select aria-label={ar ? "الشركات المستقلة" : "Independent companies"}
        value={user?.id || ""} disabled={busy} onChange={e => changeAccount(e.target.value)}>
        {accounts.map(a => <option key={a.userId} value={a.userId} disabled={a.suspended}>
          {a.name} — ID {a.code}{a.suspended ? (ar ? " (معلّقة)" : " (suspended)") : ""}
        </option>)}
      </select>
    </label>}
    {busy && <span role="status">{ar ? "جارٍ الانتقال…" : "Switching…"}</span>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
