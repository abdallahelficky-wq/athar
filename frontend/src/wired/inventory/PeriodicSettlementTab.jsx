import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listSettlementCandidates, createSettlement } from "../../api/periodicSettlement";
import { fmt2 } from "../../legacy/constants";

// انحراف تكلفة الوحدة المُدخَلة عن آخر سعر شراء فعلي يستحق تنبيهاً لطيفاً (لا يمنع الحفظ إطلاقاً) —
// نسبة اعتباطية معقولة، قابلة للتعديل لاحقاً لو ثبت أنها مزعجة عملياً.
const DEVIATION_WARNING_THRESHOLD = 0.2;

export default function PeriodicSettlementTab({ companyId }) {
  const { t } = useTranslation();
  const [candidates, setCandidates] = useState([]);
  const [inputs, setInputs] = useState({});
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [results, setResults] = useState(null);
  const [saving, setSaving] = useState(false);

  const reload = () => {
    if (!companyId) return;
    setLoading(true);
    setError("");
    listSettlementCandidates(companyId)
      .then((rows) => {
        setCandidates(rows);
        setInputs((prev) => {
          const next = {};
          rows.forEach((r) => {
            next[r.id] = prev[r.id] || { countedQuantity: "", unitCost: r.suggestedUnitCost != null ? String(r.suggestedUnitCost) : "" };
          });
          return next;
        });
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(reload, [companyId]);

  const updateInput = (itemId, field, value) => setInputs((prev) => ({ ...prev, [itemId]: { ...prev[itemId], [field]: value } }));

  const deviationRatio = (itemId) => {
    const candidate = candidates.find((c) => c.id === itemId);
    const input = inputs[itemId];
    if (!candidate || !input || candidate.suggestedUnitCost == null || !input.unitCost) return 0;
    const entered = Number(input.unitCost);
    if (!entered || !candidate.suggestedUnitCost) return 0;
    return Math.abs(entered - candidate.suggestedUnitCost) / candidate.suggestedUnitCost;
  };

  const readyLines = candidates
    .filter((c) => inputs[c.id]?.countedQuantity !== "" && inputs[c.id]?.countedQuantity != null)
    .map((c) => ({
      itemId: c.id,
      countedQuantity: Number(inputs[c.id].countedQuantity),
      unitCost: Number(inputs[c.id].unitCost || 0),
    }));

  const save = async () => {
    if (!readyLines.length) return;
    setSaving(true);
    setError("");
    setResults(null);
    try {
      const res = await createSettlement({ companyId, date, lines: readyLines });
      setResults(res);
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  return (
    <div>
      <div className="panel form-panel">
        <p className="note">{t("inventory.periodicSettlement.intro")}</p>
        <div className="form-grid">
          <label>{t("inventory.periodicSettlement.date")}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>

        {loading ? (
          <p className="empty">{t("inventory.periodicSettlement.loading")}</p>
        ) : candidates.length === 0 ? (
          <p className="empty">{t("inventory.periodicSettlement.empty")}</p>
        ) : (
          <div className="lines-table-wrap">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>{t("inventory.periodicSettlement.item")}</th>
                  <th>{t("inventory.periodicSettlement.trackedQuantity")}</th>
                  <th>{t("inventory.periodicSettlement.currentValue")}</th>
                  <th>{t("inventory.periodicSettlement.countedQuantity")}</th>
                  <th>{t("inventory.periodicSettlement.unitCost")}</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name} <span className="item-code">({c.code})</span></td>
                    <td className="num">{fmt2(c.trackedQuantity)} {c.unit}</td>
                    <td className="num">{fmt2(c.currentStockValue)}</td>
                    <td>
                      <input
                        type="number" min="0" step="0.01"
                        value={inputs[c.id]?.countedQuantity ?? ""}
                        onChange={(e) => updateInput(c.id, "countedQuantity", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number" min="0" step="0.0001"
                        value={inputs[c.id]?.unitCost ?? ""}
                        onChange={(e) => updateInput(c.id, "unitCost", e.target.value)}
                      />
                      {deviationRatio(c.id) > DEVIATION_WARNING_THRESHOLD && (
                        <div className="note balance-bad">{t("inventory.periodicSettlement.deviationWarning", { price: fmt2(c.suggestedUnitCost) })}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {error && <p className="balance-bad">{error}</p>}
        <button className="btn-primary" onClick={save} disabled={!readyLines.length || saving}>
          {saving ? t("inventory.periodicSettlement.saving") : t("inventory.periodicSettlement.saveBtn")}
        </button>
      </div>

      {results && (
        <div className="panel">
          <strong>{t("inventory.periodicSettlement.resultsTitle")}</strong>
          <table className="ledger-table">
            <thead>
              <tr>
                <th>{t("inventory.periodicSettlement.item")}</th>
                <th>{t("inventory.periodicSettlement.netAdjustment")}</th>
                <th>{t("inventory.periodicSettlement.quantityVariance")}</th>
                <th>{t("inventory.periodicSettlement.newValue")}</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.itemId}>
                  <td>{r.itemName}</td>
                  <td className={`num ${r.netAdjustment < 0 ? "balance-bad" : ""}`}>{fmt2(r.netAdjustment)}</td>
                  <td className="num">{fmt2(r.quantityVariance)}</td>
                  <td className="num">{fmt2(r.closingValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
