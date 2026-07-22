import React, { useState } from "react";
import { COMPANIES, ASSET_CATEGORIES, assetAccumulatedDepreciation, monthLabel, fmt } from "./constants";
import { Icon, MiniDonut, MiniBarChart } from "./shared";

export function emptyAssetForm(companyId) {
  return { name: "", category: ASSET_CATEGORIES[0], company: companyId === "all" ? "tesm" : companyId, purchaseDate: "2026-07-20", cost: "", usefulLifeYears: 5, salvageValue: "0", paymentMethod: "cash" };
}

export function AssetRegisterModule({ assets, setAssets, entries, setEntries, companyId }) {
  const [form, setForm] = useState(emptyAssetForm(companyId));
  const [editingId, setEditingId] = useState(null);
  const list = companyId === "all" ? assets : assets.filter((a) => a.company === companyId);

  const resetForm = () => { setEditingId(null); setForm(emptyAssetForm(companyId)); };
  const startEdit = (a) => { if (a.status === "disposed") return; setEditingId(a.id); setForm({ ...a }); };

  const saveAsset = () => {
    if (!form.name || !form.cost) return;
    const cleaned = { ...form, cost: Number(form.cost), usefulLifeYears: Number(form.usefulLifeYears), salvageValue: Number(form.salvageValue || 0) };
    if (editingId) {
      setAssets((prev) => prev.map((a) => (a.id === editingId ? { ...a, ...cleaned } : a)));
      resetForm();
      return;
    }
    const creditAccount = form.paymentMethod === "cash" ? "النقدية بالصندوق" : form.paymentMethod === "bank" ? "البنك الأهلي - حساب تشغيلي" : "ذمم دائنة - موردين";
    const jLines = [
      { account: "الأصول الثابتة", costCenter: "", department: "المالية والحسابات", debit: cleaned.cost, credit: 0 },
      { account: creditAccount, costCenter: "", department: "المالية والحسابات", debit: 0, credit: cleaned.cost },
    ];
    const entryId = entries.length ? Math.max(...entries.map((e) => e.id)) + 1 : 1;
    setEntries((prev) => [...prev, { id: entryId, company: cleaned.company, date: cleaned.purchaseDate, memo: `شراء أصل ثابت — ${cleaned.name}`, lines: jLines }]);
    setAssets((prev) => [...prev, { id: prev.length ? Math.max(...prev.map((a) => a.id)) + 1 : 1, ...cleaned, status: "active", journalEntryId: entryId }]);
    resetForm();
  };

  const [searchText, setSearchText] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  return (
    <div>
      <div className="panel form-panel">
        {editingId && <div className="edit-banner">تعديل الأصل — {form.name}</div>}
        <div className="form-grid">
          <label>اسم الأصل<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>التصنيف<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{ASSET_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label>الشركة<select value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })}>{COMPANIES.filter((c) => c.id !== "all").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>تاريخ الشراء<input type="date" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} /></label>
          <label>التكلفة<input type="number" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></label>
          <label>العمر الإنتاجي (سنوات)<input type="number" value={form.usefulLifeYears} onChange={(e) => setForm({ ...form, usefulLifeYears: e.target.value })} /></label>
          <label>القيمة التخريدية<input type="number" value={form.salvageValue} onChange={(e) => setForm({ ...form, salvageValue: e.target.value })} /></label>
          {!editingId && <label>طريقة السداد<select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}><option value="cash">نقدي</option><option value="bank">بنكي</option><option value="credit">آجل (ذمم دائنة)</option></select></label>}
        </div>
        <div className="form-btn-group">
          {editingId && <button className="btn-ghost" onClick={resetForm}>إلغاء</button>}
          <button className="btn-primary" onClick={saveAsset}>{editingId ? "حفظ التعديلات" : "حفظ الأصل وترحيل الشراء"}</button>
        </div>
      </div>

      {list.length > 0 && (() => {
        const activeCount = list.filter((a) => a.status !== "disposed").length;
        const disposedCount = list.length - activeCount;
        const byCategory = {};
        list.forEach((a) => { byCategory[a.category] = (byCategory[a.category] || 0) + a.cost; });
        const palette = ["#2F5D5A", "#B98B4E", "#3E6B8A", "#8A5A3E", "#A8432B", "#6B4E8A"];
        return (
          <div className="analytics-row">
            <MiniDonut title="الأصول حسب الحالة" segments={[{ label: "نشط", value: activeCount, color: "#2F5D5A" }, { label: "مستبعد", value: disposedCount, color: "#A8432B" }]} />
            <MiniBarChart title="تكلفة الأصول حسب التصنيف" bars={Object.entries(byCategory).map(([label, value], i) => ({ label, value, color: palette[i % palette.length] }))} />
          </div>
        );
      })()}

      <div className="panel">
        <div className="filter-bar">
          <input type="text" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="بحث باسم الأصل" />
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">كل التصنيفات</option>
            {ASSET_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <table className="ledger-table">
          <thead><tr><th>الأصل</th><th>التصنيف</th><th>الشركة</th><th>تاريخ الشراء</th><th>التكلفة</th><th>مجمع الإهلاك</th><th>صافي القيمة الدفترية</th><th>الحالة</th><th></th></tr></thead>
          <tbody>
            {list.filter((a) => (!searchText || a.name.includes(searchText)) && (!categoryFilter || a.category === categoryFilter)).map((a) => {
              const accDep = assetAccumulatedDepreciation(a, "2026-07-20");
              const nbv = a.cost - accDep;
              return (
                <tr key={a.id}>
                  <td>{a.name}</td><td>{a.category}</td><td>{COMPANIES.find((c) => c.id === a.company)?.short}</td>
                  <td>{a.purchaseDate}</td><td className="num">{fmt(a.cost)}</td><td className="num">{fmt(accDep)}</td>
                  <td className="num strong">{fmt(nbv)}</td>
                  <td><span className="status-badge">{a.status === "disposed" ? "مستبعد" : "نشط"}</span></td>
                  <td>{a.status !== "disposed" && <button className="icon-btn" title="تعديل" onClick={() => startEdit(a)}><Icon.Edit /></button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.length === 0 && <p className="empty">لا توجد أصول ثابتة مسجّلة بعد.</p>}
      </div>
    </div>
  );
}

export function DepreciationModule({ assets, depreciationRuns, setDepreciationRuns, entries, setEntries, companyId }) {
  const [month, setMonth] = useState("2026-07");
  const companyAssets = (companyId === "all" ? assets : assets.filter((a) => a.company === companyId)).filter((a) => a.status !== "disposed");
  const existingRun = companyId !== "all" ? depreciationRuns.find((r) => r.company === companyId && r.month === month) : null;

  const rows = companyAssets.map((a) => {
    const monthly = a.usefulLifeYears > 0 ? (a.cost - (a.salvageValue || 0)) / a.usefulLifeYears / 12 : 0;
    return { asset: a, monthly };
  });
  const total = rows.reduce((s, r) => s + r.monthly, 0);

  const postDepreciation = () => {
    if (companyId === "all" || existingRun || total <= 0) return;
    const jLines = [
      { account: "مصروف إهلاك الأصول الثابتة", costCenter: "", department: "المالية والحسابات", debit: total, credit: 0 },
      { account: "مجمع الإهلاك", costCenter: "", department: "المالية والحسابات", debit: 0, credit: total },
    ];
    const entryId = entries.length ? Math.max(...entries.map((e) => e.id)) + 1 : 1;
    setEntries((prev) => [...prev, { id: entryId, company: companyId, date: `${month}-28`, memo: `إهلاك شهر ${monthLabel(month)}`, lines: jLines }]);
    setDepreciationRuns((prev) => [...prev, { id: prev.length ? Math.max(...prev.map((r) => r.id)) + 1 : 1, company: companyId, month, totalAmount: total, journalEntryId: entryId }]);
  };

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid"><label>الشهر<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label></div>
        {companyId === "all" && <p className="empty">اختر شركة محددة من أيقونات لوحة القيادة لترحيل إهلاك الشهر.</p>}
        {existingRun && <p className="note">تم ترحيل إهلاك هذا الشهر مسبقاً بمبلغ {fmt(existingRun.totalAmount)} ر.س.</p>}
        <button className="btn-primary" onClick={postDepreciation} disabled={companyId === "all" || !!existingRun || total <= 0}>ترحيل إهلاك {monthLabel(month)}</button>
      </div>
      <div className="panel">
        <table className="ledger-table">
          <thead><tr><th>الأصل</th><th>التكلفة</th><th>العمر الإنتاجي</th><th>الإهلاك الشهري</th></tr></thead>
          <tbody>{rows.map((r) => (<tr key={r.asset.id}><td>{r.asset.name}</td><td className="num">{fmt(r.asset.cost)}</td><td className="num">{r.asset.usefulLifeYears} سنة</td><td className="num">{fmt(r.monthly)}</td></tr>))}</tbody>
          <tfoot><tr><td className="foot-label" colSpan={3}>الإجمالي</td><td className="num strong">{fmt(total)}</td></tr></tfoot>
        </table>
        {rows.length === 0 && <p className="empty">لا توجد أصول نشطة لحساب إهلاكها.</p>}
      </div>
    </div>
  );
}

export function DisposalModule({ assets, setAssets, entries, setEntries, companyId }) {
  const companyAssets = (companyId === "all" ? assets : assets.filter((a) => a.company === companyId)).filter((a) => a.status !== "disposed");
  const [assetId, setAssetId] = useState(companyAssets[0]?.id || "");
  const [disposalDate, setDisposalDate] = useState("2026-07-20");
  const [salePrice, setSalePrice] = useState("0");
  const [method, setMethod] = useState("cash");

  const asset = assets.find((a) => a.id === assetId);
  const accDep = asset ? assetAccumulatedDepreciation(asset, disposalDate) : 0;
  const nbv = asset ? asset.cost - accDep : 0;
  const gainLoss = Number(salePrice || 0) - nbv;

  const disposeAsset = () => {
    if (!asset) return;
    const receiveAccount = method === "cash" ? "النقدية بالصندوق" : "البنك الأهلي - حساب تشغيلي";
    const jLines = [
      { account: "مجمع الإهلاك", costCenter: "", department: "المالية والحسابات", debit: accDep, credit: 0 },
    ];
    if (Number(salePrice) > 0) jLines.push({ account: receiveAccount, costCenter: "", department: "المالية والحسابات", debit: Number(salePrice), credit: 0 });
    if (gainLoss > 0) jLines.push({ account: "أرباح استبعاد أصول", costCenter: "", department: "المالية والحسابات", debit: 0, credit: gainLoss });
    if (gainLoss < 0) jLines.push({ account: "خسائر استبعاد أصول", costCenter: "", department: "المالية والحسابات", debit: -gainLoss, credit: 0 });
    jLines.push({ account: "الأصول الثابتة", costCenter: "", department: "المالية والحسابات", debit: 0, credit: asset.cost });

    const entryId = entries.length ? Math.max(...entries.map((e) => e.id)) + 1 : 1;
    setEntries((prev) => [...prev, { id: entryId, company: asset.company, date: disposalDate, memo: `استبعاد أصل — ${asset.name}`, lines: jLines }]);
    setAssets((prev) => prev.map((a) => (a.id === asset.id ? { ...a, status: "disposed", disposalDate, disposalValue: Number(salePrice) } : a)));
  };

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>الأصل<select value={assetId} onChange={(e) => setAssetId(Number(e.target.value))}>{companyAssets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label>تاريخ الاستبعاد<input type="date" value={disposalDate} onChange={(e) => setDisposalDate(e.target.value)} /></label>
          <label>سعر البيع (صفر إن كان إتلافاً)<input type="number" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} /></label>
          <label>طريقة الاستلام<select value={method} onChange={(e) => setMethod(e.target.value)}><option value="cash">نقدي</option><option value="bank">بنكي</option></select></label>
        </div>
        {asset && (
          <div className="preview-box">
            <div className="preview-row"><span>مجمع الإهلاك حتى تاريخ الاستبعاد</span><strong>{fmt(accDep)} ر.س</strong></div>
            <div className="preview-row"><span>صافي القيمة الدفترية</span><strong>{fmt(nbv)} ر.س</strong></div>
            <div className="preview-row net-row"><span>{gainLoss >= 0 ? "ربح الاستبعاد" : "خسارة الاستبعاد"}</span><strong>{fmt(Math.abs(gainLoss))} ر.س</strong></div>
          </div>
        )}
        <button className="btn-primary" onClick={disposeAsset} disabled={!asset}>ترحيل الاستبعاد</button>
        {companyAssets.length === 0 && <p className="empty">لا توجد أصول نشطة لاستبعادها.</p>}
      </div>
    </div>
  );
}

export function AssetReportsModule({ assets, companyId }) {
  const list = companyId === "all" ? assets : assets.filter((a) => a.company === companyId);
  const totals = list.reduce((s, a) => {
    const dep = assetAccumulatedDepreciation(a, "2026-07-20");
    s.cost += a.cost; s.dep += dep; s.nbv += a.cost - dep;
    return s;
  }, { cost: 0, dep: 0, nbv: 0 });

  return (
    <div>
      <div className="gauge-row gauge-row-3">
        <Gauge label="إجمالي تكلفة الأصول" value={totals.cost} max={500000} unit="ر.س" tone="#2F5D5A" />
        <Gauge label="مجمع الإهلاك" value={totals.dep} max={200000} unit="ر.س" tone="#A8432B" />
        <Gauge label="صافي القيمة الدفترية" value={totals.nbv} max={500000} unit="ر.س" tone="#B98B4E" />
      </div>
      <div className="panel">
        <h3>سجل الأصول الثابتة (حتى 2026-07-20)</h3>
        <table className="ledger-table">
          <thead><tr><th>الأصل</th><th>التصنيف</th><th>الشركة</th><th>التكلفة</th><th>مجمع الإهلاك</th><th>صافي القيمة الدفترية</th><th>الحالة</th></tr></thead>
          <tbody>
            {list.map((a) => {
              const dep = assetAccumulatedDepreciation(a, "2026-07-20");
              return (
                <tr key={a.id}>
                  <td>{a.name}</td><td>{a.category}</td><td>{COMPANIES.find((c) => c.id === a.company)?.short}</td>
                  <td className="num">{fmt(a.cost)}</td><td className="num">{fmt(dep)}</td><td className="num strong">{fmt(a.cost - dep)}</td>
                  <td>{a.status === "disposed" ? "مستبعد" : "نشط"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr><td className="foot-label" colSpan={3}>الإجمالي</td><td className="num strong">{fmt(totals.cost)}</td><td className="num strong">{fmt(totals.dep)}</td><td className="num strong">{fmt(totals.nbv)}</td><td></td></tr></tfoot>
        </table>
        {list.length === 0 && <p className="empty">لا توجد أصول مسجّلة بعد.</p>}
      </div>
    </div>
  );
}

export const FIXED_ASSETS_TABS = [
  { id: "register", label: "سجل الأصول" },
  { id: "depreciation", label: "الإهلاك" },
  { id: "disposal", label: "الاستبعاد / البيع" },
  { id: "reports", label: "التقارير" },
];

export function FixedAssetsModule({ assets, setAssets, depreciationRuns, setDepreciationRuns, entries, setEntries, companyId, tab, setTab }) {
  return (
    <div>
      <div className="section-title"><span className="eyebrow">إدارة الممتلكات</span><h2>الأصول الثابتة</h2></div>
      <div className="report-tabs">{FIXED_ASSETS_TABS.map((t) => (<button key={t.id} className={"report-tab" + (tab === t.id ? " active" : "")} onClick={() => setTab(t.id)}>{t.label}</button>))}</div>
      {tab === "register" && <AssetRegisterModule assets={assets} setAssets={setAssets} entries={entries} setEntries={setEntries} companyId={companyId} />}
      {tab === "depreciation" && <DepreciationModule assets={assets} depreciationRuns={depreciationRuns} setDepreciationRuns={setDepreciationRuns} entries={entries} setEntries={setEntries} companyId={companyId} />}
      {tab === "disposal" && <DisposalModule assets={assets} setAssets={setAssets} entries={entries} setEntries={setEntries} companyId={companyId} />}
      {tab === "reports" && <AssetReportsModule assets={assets} companyId={companyId} />}
    </div>
  );
}
