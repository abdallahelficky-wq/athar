import React, { useState } from "react";
import { COMPANIES, COST_CENTERS, DEPARTMENTS, UNITS, emptyItemForm, costCenterName, fmt, fmt2 } from "./constants";
import { Icon, MiniDonut, downloadCsv } from "./shared";

export function stockBalance(movements, itemId, warehouseId) {
  return movements
    .filter((m) => m.itemId === itemId && (!warehouseId || m.warehouseId === warehouseId))
    .reduce((s, m) => s + (["in", "transfer_in"].includes(m.type) ? m.quantity : -m.quantity), 0);
}

export function ItemsDirectory({ items, setItems, companyId }) {
  const [form, setForm] = useState(emptyItemForm(companyId));
  const [editingId, setEditingId] = useState(null);
  const [searchText, setSearchText] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const list = companyId === "all" ? items : items.filter((i) => i.company === companyId);

  const resetForm = () => { setEditingId(null); setForm(emptyItemForm(companyId)); };
  const startEdit = (i) => { setEditingId(i.id); setForm({ ...i }); };

  const saveItem = () => {
    if (!form.name || !form.code) return;
    const cleaned = { ...form, costPrice: Number(form.costPrice || 0), reorderLevel: Number(form.reorderLevel || 0) };
    if (editingId) {
      setItems((prev) => prev.map((i) => (i.id === editingId ? { ...i, ...cleaned } : i)));
    } else {
      setItems((prev) => [...prev, { id: prev.length ? Math.max(...prev.map((i) => i.id)) + 1 : 1, ...cleaned }]);
    }
    resetForm();
  };
  const deleteItem = (i) => {
    if (!window.confirm(`حذف الصنف "${i.name}"؟`)) return;
    setItems((prev) => prev.filter((x) => x.id !== i.id));
  };
  const exportItemsCsv = () => {
    const rows = [["الكود", "الاسم", "الشركة", "الوحدة", "التصنيف", "تكلفة الوحدة", "حد الطلب"]];
    list.forEach((i) => rows.push([i.code, i.name, COMPANIES.find((c) => c.id === i.company)?.short, i.unit, i.category, i.costPrice, i.reorderLevel]));
    downloadCsv("الأصناف.csv", rows);
  };

  const categories = [...new Set(list.map((i) => i.category).filter(Boolean))];
  const byCategory = {};
  list.forEach((i) => { byCategory[i.category || "غير مصنّف"] = (byCategory[i.category || "غير مصنّف"] || 0) + 1; });
  const palette = ["#2F5D5A", "#B98B4E", "#3E6B8A", "#8A5A3E", "#A8432B", "#6B4E8A"];
  const filtered = list.filter((i) => {
    if (searchText && !(i.name.includes(searchText) || i.code.includes(searchText))) return false;
    if (categoryFilter && i.category !== categoryFilter) return false;
    return true;
  });

  return (
    <div>
      <div className="panel form-panel">
        {editingId && <div className="edit-banner">تعديل الصنف — {form.name}</div>}
        <div className="form-grid">
          <label>كود الصنف<input type="text" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="مثال: OIL-5W30" /></label>
          <label>اسم الصنف<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>الشركة<select value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })}>{COMPANIES.filter((c) => c.id !== "all").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>وحدة القياس<select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select></label>
          <label>التصنيف<input type="text" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></label>
          <label>تكلفة الوحدة<input type="number" value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} placeholder="0" /></label>
          <label>حد إعادة الطلب<input type="number" value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} placeholder="0" /></label>
        </div>
        <div className="form-btn-group">
          {editingId && <button className="btn-ghost" onClick={resetForm}>إلغاء</button>}
          <button className="btn-primary" onClick={saveItem}>{editingId ? "حفظ التعديلات" : "حفظ الصنف"}</button>
        </div>
      </div>

      {list.length > 0 && (
        <div className="analytics-row">
          <MiniDonut
            title="توزيع الأصناف حسب التصنيف"
            segments={Object.entries(byCategory).map(([label, value], i) => ({ label, value, color: palette[i % palette.length] }))}
          />
        </div>
      )}

      <div className="panel">
        <div className="filter-bar">
          <input type="text" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="بحث بالاسم أو الكود" />
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">كل التصنيفات</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="btn-ghost" onClick={exportItemsCsv}>تصدير الكل Excel</button>
        </div>
        <table className="ledger-table">
          <thead><tr><th>الكود</th><th>الاسم</th><th>الشركة</th><th>الوحدة</th><th>التصنيف</th><th>تكلفة الوحدة</th><th>حد الطلب</th><th></th></tr></thead>
          <tbody>
            {filtered.map((i) => (
              <tr key={i.id}>
                <td>{i.code}</td><td>{i.name}</td><td>{COMPANIES.find((c) => c.id === i.company)?.short}</td>
                <td>{i.unit}</td><td>{i.category || "—"}</td><td className="num">{fmt2(i.costPrice)}</td><td className="num">{i.reorderLevel}</td>
                <td className="row-actions">
                  <button className="icon-btn" title="تعديل" onClick={() => startEdit(i)}><Icon.Edit /></button>
                  <button className="icon-btn icon-btn-danger" title="حذف" onClick={() => deleteItem(i)}><Icon.Trash /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="empty">لا توجد أصناف مطابقة.</p>}
      </div>
    </div>
  );
}

export function StockInOutModule({ items, movements, setMovements, entries, setEntries, companyId }) {
  const companyItems = companyId === "all" ? items : items.filter((i) => i.company === companyId);
  const companyCC = companyId === "all" ? COST_CENTERS : COST_CENTERS.filter((c) => c.company === "all" || c.company === companyId);
  const [type, setType] = useState("in");
  const [itemId, setItemId] = useState(companyItems[0]?.id || "");
  const [warehouseId, setWarehouseId] = useState(companyCC[0]?.id || "");
  const [quantity, setQuantity] = useState("");
  const [date, setDate] = useState("2026-07-20");
  const [note, setNote] = useState("");

  const item = items.find((i) => i.id === itemId);
  const currentBalance = item ? stockBalance(movements, item.id, warehouseId) : 0;

  const save = () => {
    if (!item || !Number(quantity) || Number(quantity) <= 0) return;
    const qty = Number(quantity);
    const amount = qty * item.costPrice;
    const jLines = type === "in"
      ? [
          { account: "المخزون", costCenter: warehouseId, department: "المشتريات", debit: amount, credit: 0 },
          { account: "تسويات المخزون", costCenter: warehouseId, department: "المالية والحسابات", debit: 0, credit: amount },
        ]
      : [
          { account: "مصروف تالف ونقص المخزون", costCenter: warehouseId, department: "المالية والحسابات", debit: amount, credit: 0 },
          { account: "المخزون", costCenter: warehouseId, department: "المشتريات", debit: 0, credit: amount },
        ];
    const entryId = entries.length ? Math.max(...entries.map((e) => e.id)) + 1 : 1;
    setEntries((prev) => [...prev, { id: entryId, company: item.company, date, memo: `${STOCK_MOVE_TYPES[type]} — ${item.name}`, lines: jLines }]);
    setMovements((prev) => [...prev, { id: prev.length ? Math.max(...prev.map((m) => m.id)) + 1 : 1, date, company: item.company, itemId: item.id, warehouseId, type, quantity: qty, unitCost: item.costPrice, note, journalEntryId: entryId }]);
    setQuantity(""); setNote("");
  };

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>الحركة<select value={type} onChange={(e) => setType(e.target.value)}><option value="in">إضافة مخزون</option><option value="out">حذف / إتلاف مخزون</option></select></label>
          <label>الصنف<select value={itemId} onChange={(e) => setItemId(Number(e.target.value))}>{companyItems.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
          <label>الموقع / المخزن<select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>{companyCC.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>الكمية<input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label>
          <label>التاريخ<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="memo-field">ملاحظة<input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="سبب الحركة" /></label>
        </div>
        {item && <p className="note">الرصيد الحالي لهذا الصنف في هذا الموقع: <strong>{fmt2(currentBalance)} {item.unit}</strong></p>}
        <button className="btn-primary" onClick={save} disabled={!item || !Number(quantity)}>حفظ الحركة</button>
      </div>
      <StockMovementsTable items={items} movements={movements} companyId={companyId} filterTypes={["in", "out"]} />
    </div>
  );
}

export function IssueModule({ items, movements, setMovements, entries, setEntries, companyId }) {
  const companyItems = companyId === "all" ? items : items.filter((i) => i.company === companyId);
  const companyCC = companyId === "all" ? COST_CENTERS : COST_CENTERS.filter((c) => c.company === "all" || c.company === companyId);
  const [itemId, setItemId] = useState(companyItems[0]?.id || "");
  const [warehouseId, setWarehouseId] = useState(companyCC[0]?.id || "");
  const [department, setDepartment] = useState(DEPARTMENTS[0]);
  const [quantity, setQuantity] = useState("");
  const [date, setDate] = useState("2026-07-20");
  const [note, setNote] = useState("");

  const item = items.find((i) => i.id === itemId);
  const currentBalance = item ? stockBalance(movements, item.id, warehouseId) : 0;

  const save = () => {
    if (!item || !Number(quantity) || Number(quantity) <= 0 || Number(quantity) > currentBalance) return;
    const qty = Number(quantity);
    const amount = qty * item.costPrice;
    const jLines = [
      { account: "تكلفة البضاعة المباعة / الصرف المخزني", costCenter: warehouseId, department, debit: amount, credit: 0 },
      { account: "المخزون", costCenter: warehouseId, department: "المشتريات", debit: 0, credit: amount },
    ];
    const entryId = entries.length ? Math.max(...entries.map((e) => e.id)) + 1 : 1;
    setEntries((prev) => [...prev, { id: entryId, company: item.company, date, memo: `صرف مخزني — ${item.name} (${department})`, lines: jLines }]);
    setMovements((prev) => [...prev, { id: prev.length ? Math.max(...prev.map((m) => m.id)) + 1 : 1, date, company: item.company, itemId: item.id, warehouseId, type: "issue", quantity: qty, unitCost: item.costPrice, note: `${department} — ${note}`, journalEntryId: entryId }]);
    setQuantity(""); setNote("");
  };

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>الصنف<select value={itemId} onChange={(e) => setItemId(Number(e.target.value))}>{companyItems.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
          <label>الموقع / المخزن<select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>{companyCC.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>القسم المستفيد<select value={department} onChange={(e) => setDepartment(e.target.value)}>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</select></label>
          <label>الكمية<input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label>
          <label>التاريخ<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="memo-field">ملاحظة<input type="text" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        </div>
        {item && <p className="note">الرصيد المتاح: <strong>{fmt2(currentBalance)} {item.unit}</strong> {Number(quantity) > currentBalance && <span className="balance-bad"> — الكمية المطلوبة أكبر من الرصيد المتاح</span>}</p>}
        <button className="btn-primary" onClick={save} disabled={!item || !Number(quantity) || Number(quantity) > currentBalance}>صرف من المخزون</button>
      </div>
      <StockMovementsTable items={items} movements={movements} companyId={companyId} filterTypes={["issue"]} />
    </div>
  );
}

export function TransferModule({ items, movements, setMovements, entries, setEntries, companyId }) {
  const [itemId, setItemId] = useState(items[0]?.id || "");
  const [fromWarehouseId, setFromWarehouseId] = useState(COST_CENTERS[0]?.id || "");
  const [toWarehouseId, setToWarehouseId] = useState(COST_CENTERS[1]?.id || "");
  const [toCompany, setToCompany] = useState(items[0]?.company || "tesm");
  const [quantity, setQuantity] = useState("");
  const [date, setDate] = useState("2026-07-20");

  const item = items.find((i) => i.id === itemId);
  const fromBalance = item ? stockBalance(movements, item.id, fromWarehouseId) : 0;
  const crossCompany = item && toCompany !== item.company;

  const save = () => {
    if (!item || !Number(quantity) || Number(quantity) <= 0 || Number(quantity) > fromBalance) return;
    const qty = Number(quantity);
    const amount = qty * item.costPrice;
    const entryId0 = entries.length ? Math.max(...entries.map((e) => e.id)) + 1 : 1;

    if (!crossCompany) {
      const jLines = [
        { account: "المخزون", costCenter: toWarehouseId, department: "المشتريات", debit: amount, credit: 0 },
        { account: "المخزون", costCenter: fromWarehouseId, department: "المشتريات", debit: 0, credit: amount },
      ];
      setEntries((prev) => [...prev, { id: entryId0, company: item.company, date, memo: `تحويل مخزني داخلي — ${item.name}`, lines: jLines }]);
    } else {
      const entrySource = { id: entryId0, company: item.company, date, memo: `تحويل مخزون صادر لشركة أخرى — ${item.name}`, lines: [
        { account: "حساب جاري - شركات المجموعة", costCenter: fromWarehouseId, department: "المالية والحسابات", debit: amount, credit: 0 },
        { account: "المخزون", costCenter: fromWarehouseId, department: "المشتريات", debit: 0, credit: amount },
      ] };
      const entryDest = { id: entryId0 + 1, company: toCompany, date, memo: `تحويل مخزون وارد من شركة أخرى — ${item.name}`, lines: [
        { account: "المخزون", costCenter: toWarehouseId, department: "المشتريات", debit: amount, credit: 0 },
        { account: "حساب جاري - شركات المجموعة", costCenter: toWarehouseId, department: "المالية والحسابات", debit: 0, credit: amount },
      ] };
      setEntries((prev) => [...prev, entrySource, entryDest]);
    }

    setMovements((prev) => [
      ...prev,
      { id: prev.length ? Math.max(...prev.map((m) => m.id)) + 1 : 1, date, company: item.company, itemId: item.id, warehouseId: fromWarehouseId, type: "transfer_out", quantity: qty, unitCost: item.costPrice, note: crossCompany ? `تحويل لشركة ${COMPANIES.find((c) => c.id === toCompany)?.short}` : "تحويل داخلي", journalEntryId: entryId0 },
      { id: (prev.length ? Math.max(...prev.map((m) => m.id)) + 1 : 1) + 1, date, company: toCompany, itemId: item.id, warehouseId: toWarehouseId, type: "transfer_in", quantity: qty, unitCost: item.costPrice, note: "وارد بالتحويل", journalEntryId: entryId0 },
    ]);
    setQuantity("");
  };

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>الصنف<select value={itemId} onChange={(e) => setItemId(Number(e.target.value))}>{items.map((i) => <option key={i.id} value={i.id}>{i.name} ({COMPANIES.find((c) => c.id === i.company)?.short})</option>)}</select></label>
          <label>من موقع (المصدر)<select value={fromWarehouseId} onChange={(e) => setFromWarehouseId(e.target.value)}>{COST_CENTERS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>الشركة المستقبلة<select value={toCompany} onChange={(e) => setToCompany(e.target.value)}>{COMPANIES.filter((c) => c.id !== "all").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>إلى موقع (الوجهة)<select value={toWarehouseId} onChange={(e) => setToWarehouseId(e.target.value)}>{COST_CENTERS.filter((c) => c.company === "all" || c.company === toCompany).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>الكمية<input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label>
          <label>التاريخ<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        {item && <p className="note">الرصيد المتاح بالمصدر: <strong>{fmt2(fromBalance)} {item.unit}</strong>{crossCompany && " — تحويل بين شركتين مختلفتين، سيُرحّل عبر حساب جاري بين الشركات ويحتاج مراجعة محاسبية لاحقاً."}</p>}
        <button className="btn-primary" onClick={save} disabled={!item || !Number(quantity) || Number(quantity) > fromBalance}>تنفيذ التحويل</button>
      </div>
      <StockMovementsTable items={items} movements={movements} companyId={companyId} filterTypes={["transfer_out", "transfer_in"]} />
    </div>
  );
}

export function StockMovementsTable({ items, movements, companyId, filterTypes }) {
  const list = movements
    .filter((m) => filterTypes.includes(m.type))
    .filter((m) => companyId === "all" || m.company === companyId)
    .slice().reverse();
  return (
    <div className="panel">
      <table className="ledger-table">
        <thead><tr><th>التاريخ</th><th>الصنف</th><th>الحركة</th><th>الموقع</th><th>الكمية</th><th>القيمة</th><th>ملاحظة</th></tr></thead>
        <tbody>
          {list.map((m) => {
            const it = items.find((i) => i.id === m.itemId);
            return (
              <tr key={m.id}>
                <td>{m.date}</td><td>{it?.name}</td><td>{STOCK_MOVE_TYPES[m.type]}</td>
                <td>{costCenterName(m.warehouseId)}</td><td className="num">{fmt2(m.quantity)}</td>
                <td className="num">{fmt(m.quantity * m.unitCost)}</td><td>{m.note || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {list.length === 0 && <p className="empty">لا توجد حركات مسجّلة من هذا النوع بعد.</p>}
    </div>
  );
}

export function StockReportModule({ items, movements, companyId }) {
  const companyItems = companyId === "all" ? items : items.filter((i) => i.company === companyId);
  return (
    <div className="panel">
      <h3>أرصدة المخزون الحالية حسب الصنف والموقع</h3>
      <table className="ledger-table">
        <thead><tr><th>الصنف</th><th>الشركة</th><th>الموقع</th><th>الرصيد</th><th>القيمة التقديرية</th></tr></thead>
        <tbody>
          {companyItems.flatMap((it) => {
            const cc = COST_CENTERS.filter((c) => c.company === "all" || c.company === it.company);
            return cc.map((c) => {
              const bal = stockBalance(movements, it.id, c.id);
              if (bal === 0) return null;
              return (
                <tr key={it.id + "-" + c.id}>
                  <td>{it.name}</td><td>{COMPANIES.find((x) => x.id === it.company)?.short}</td>
                  <td>{c.name}</td><td className="num">{fmt2(bal)} {it.unit}</td><td className="num">{fmt(bal * it.costPrice)}</td>
                </tr>
              );
            });
          })}
        </tbody>
      </table>
      {companyItems.every((it) => COST_CENTERS.every((c) => stockBalance(movements, it.id, c.id) === 0)) && <p className="empty">لا توجد أرصدة مخزون مسجّلة بعد.</p>}
    </div>
  );
}

export const INVENTORY_TABS = [
  { id: "items", label: "الأصناف" },
  { id: "inout", label: "إضافة / حذف مخزون" },
  { id: "issue", label: "الصرف المخزني" },
  { id: "transfer", label: "التحويل بين الفروع" },
  { id: "stockReport", label: "أرصدة المخزون" },
];

export function InventoryModule({ items, setItems, movements, setMovements, entries, setEntries, companyId, tab, setTab }) {
  return (
    <div>
      <div className="section-title"><span className="eyebrow">إدارة المخازن</span><h2>المخزون</h2></div>
      <div className="report-tabs">{INVENTORY_TABS.map((t) => (<button key={t.id} className={"report-tab" + (tab === t.id ? " active" : "")} onClick={() => setTab(t.id)}>{t.label}</button>))}</div>
      {tab === "items" && <ItemsDirectory items={items} setItems={setItems} companyId={companyId} />}
      {tab === "inout" && <StockInOutModule items={items} movements={movements} setMovements={setMovements} entries={entries} setEntries={setEntries} companyId={companyId} />}
      {tab === "issue" && <IssueModule items={items} movements={movements} setMovements={setMovements} entries={entries} setEntries={setEntries} companyId={companyId} />}
      {tab === "transfer" && <TransferModule items={items} movements={movements} setMovements={setMovements} entries={entries} setEntries={setEntries} companyId={companyId} />}
      {tab === "stockReport" && <StockReportModule items={items} movements={movements} companyId={companyId} />}
    </div>
  );
}
