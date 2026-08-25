import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getDocumentNumberingSettings, updateDocumentNumberingSettings } from "../../api/documentNumberingSettings";

/**
 * إعدادات ترقيم مستند واحد (فاتورة مبيعات/عرض سعر/مردود مبيعات) لشركة واحدة — بادئة نصية تدعم
 * الرمز الخاص {year}، عدد أرقام العدّاد، وإعادة الترقيم (سنوياً أو تسلسل مستمر بلا انقطاع)، مع
 * معاينة حيّة للرقم التالي الفعلي المتوقَّع (مبنية على العدّاد الحقيقي المخزَّن، وليس تخميناً).
 */
export default function DocumentNumberingPanel({ companyId, docType, title }) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState({ prefix: "", digits: 5, resetMode: "continuous" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const reload = () => {
    getDocumentNumberingSettings(companyId, docType).then((s) => {
      setSettings(s);
      setDraft({ prefix: s.prefix, digits: s.digits, resetMode: s.resetMode });
    }).catch((e) => setError(e.message));
  };
  useEffect(reload, [companyId, docType]);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const updated = await updateDocumentNumberingSettings(companyId, docType, draft);
      setSettings(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!settings) return null;

  return (
    <div className="numbering-panel">
      <h4 className="sub-head">{title}</h4>
      <div className="form-grid">
        <label>
          {t("sales.settings.numberingPrefixLabel")}
          <input type="text" value={draft.prefix} onChange={(e) => setDraft({ ...draft, prefix: e.target.value })} />
        </label>
        <label>
          {t("sales.settings.numberingDigitsLabel")}
          <input type="number" min={3} max={10} value={draft.digits} onChange={(e) => setDraft({ ...draft, digits: e.target.value })} />
        </label>
        <label>
          {t("sales.settings.numberingResetLabel")}
          <select value={draft.resetMode} onChange={(e) => setDraft({ ...draft, resetMode: e.target.value })}>
            <option value="continuous">{t("sales.settings.numberingResetContinuous")}</option>
            <option value="annual">{t("sales.settings.numberingResetAnnual")}</option>
          </select>
        </label>
      </div>
      <p className="note">{t("sales.settings.numberingPrefixHint")}</p>
      <p className="note">{t("sales.settings.numberingNextPreview", { number: settings.nextPreview })}</p>
      {error && <p className="balance-bad">{error}</p>}
      <button className="btn-ghost" onClick={save} disabled={saving}>{t("common.save")}</button>
    </div>
  );
}
