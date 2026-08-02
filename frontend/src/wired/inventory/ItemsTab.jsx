import React, { useEffect, useMemo, useState } from "react";
import { listItems, createItem, updateItem, deleteItem } from "../../api/items";
import { fmt2 } from "../../legacy/constants";

const emptyForm = () => ({ code: "", name: "", unit: "", category: "", costPrice: "", reorderLevel: "" });

const Icons = {
  add: "＋", import: "⇧", export: "⇩", units: "▦", transfer: "⇄",
  view: "◉", edit: "✎", duplicate: "▣", archive: "▾", remove: "×", print: "▤",
};

function ActionButton({ icon, label, disabled = false, onClick, danger = false, title }) {
  return (
    <button
      type="button"
      className={`item-action-btn${danger ? " danger" : ""}`}
      aria-label={label}
      title={title || label}
      disabled={disabled}
      onClick={onClick}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  );
}

export default function ItemsTab({ companyId, onNavigateTransfer }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [lowStock, setLowStock] = useState(false);
  const [status, setStatus] = useState("active");
  const [viewItem, setViewItem] = useState(null);

  const reload = () => {
    if (!companyId) return;
    setLoading(true);
    setError("");
    listItems(companyId).then(setItems).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(reload, [companyId]);

  const categories = useMemo(() => [...new Set(items.map((item) => item.category).filter(Boolean))], [items]);
  const filteredItems = useMemo(() => items.filter((item) => {
    const text = query.trim().toLocaleLowerCase("ar");
    const matchesQuery = !text || item.name?.toLocaleLowerCase("ar").includes(text) || item.code?.toLocaleLowerCase("ar").includes(text);
    const matchesCategory = !category || item.category === category;
    // قائمة الأصناف الحالية لا تُرجع رصيداً أو حالة أرشفة، لذلك لا نفترض قيماً غير موجودة.
    const matchesStock = !lowStock || (item.quantity != null && item.reorderLevel != null && Number(item.quantity) < Number(item.reorderLevel));
    const matchesStatus = status === "active" ? item.isArchived !== true : item.isArchived === true;
    return matchesQuery && matchesCategory && matchesStock && matchesStatus;
  }), [items, query, category, lowStock, status]);

  const save = async () => {
    if (!form.code.trim() || !form.name.trim()) return;
    try {
      const payload = { ...form, companyId, costPrice: Number(form.costPrice || 0), reorderLevel: form.reorderLevel || undefined };
      if (editingId) await updateItem(editingId, payload);
      else await createItem(payload);
      setForm(emptyForm());
      setEditingId(null);
      setFormOpen(false);
      reload();
    } catch (err) { setError(err.message); }
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    setForm({ ...emptyForm(), ...item, costPrice: item.costPrice, reorderLevel: item.reorderLevel || "" });
    setFormOpen(true);
  };
  const duplicate = (item) => {
    setEditingId(null);
    setForm({ ...emptyForm(), ...item, id: undefined, code: `${item.code}-COPY`, name: `${item.name} — نسخة`, reorderLevel: item.reorderLevel || "" });
    setFormOpen(true);
  };
  const remove = async (item) => {
    if (!window.confirm(`حذف الصنف "${item.name}"؟`)) return;
    try { await deleteItem(item.id); reload(); } catch (err) { setError(err.message); }
  };
  const exportItems = () => {
    const headings = ["كود الصنف", "اسم الصنف", "الوحدة", "التصنيف", "سعر التكلفة", "حد إعادة الطلب"];
    const rows = items.map((item) => [item.code, item.name, item.unit || "", item.category || "", item.costPrice, item.reorderLevel || ""]);
    const csv = `\uFEFF${[headings, ...rows].map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\n")}`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = "الأصناف.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  };

  if (!companyId) return <p className="empty">أنشئ شركة أولاً من لوحة القيادة.</p>;

  return (
    <div className="items-page">
      <header className="items-page-header">
        <div>
          <p className="items-eyebrow">دليل المخزون</p>
          <h3>الأصناف والمنتجات</h3>
          <p>إدارة بيانات الأصناف والأسعار ومستويات المخزون من مكان واحد</p>
        </div>
        <div className="items-toolbar">
          <button className="btn-primary item-add-btn" onClick={() => { setEditingId(null); setForm(emptyForm()); setFormOpen(true); }}><span>{Icons.add}</span> إضافة صنف جديد</button>
          <button className="items-toolbar-btn" disabled title="استيراد الأصناف غير متاح في واجهة API الحالية"><span>{Icons.import}</span> استيراد أصناف</button>
          <button className="items-toolbar-btn" onClick={exportItems}><span>{Icons.export}</span> تصدير أصناف <small>CSV</small></button>
          <button className="items-toolbar-btn" disabled title="إدارة وحدات القياس غير متاحة في واجهة API الحالية"><span>{Icons.units}</span> وحدات القياس</button>
          <button className="items-toolbar-btn" onClick={onNavigateTransfer}><span>{Icons.transfer}</span> نقل بين المستودعات</button>
        </div>
      </header>

      {formOpen && <div className="panel form-panel items-form-panel">
        <div className="items-form-heading"><strong>{editingId ? `تعديل الصنف — ${form.name}` : "إضافة صنف جديد"}</strong><button className="item-close" onClick={() => setFormOpen(false)}>×</button></div>
        <div className="form-grid">
          <label>كود الصنف<input type="text" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></label>
          <label>اسم الصنف<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>الوحدة<input type="text" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="لتر، قطعة..." /></label>
          <label>التصنيف<input type="text" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></label>
          <label>سعر التكلفة<input type="number" value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} /></label>
          <label>حد إعادة الطلب<input type="number" value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} /></label>
        </div>
        <div className="form-btn-group"><button className="btn-ghost" onClick={() => setFormOpen(false)}>إلغاء</button><button className="btn-primary" onClick={save}>{editingId ? "حفظ التعديلات" : "حفظ الصنف"}</button></div>
      </div>}

      <section className="panel items-directory-panel">
        <div className="items-tabs" role="tablist">
          <button className={status === "active" ? "active" : ""} onClick={() => setStatus("active")}>نشط <span>{items.filter((i) => i.isArchived !== true).length}</span></button>
          <button className={status === "archived" ? "active" : ""} onClick={() => setStatus("archived")}>مؤرشف <span>{items.filter((i) => i.isArchived === true).length}</span></button>
        </div>
        <div className="items-filters">
          <label className="items-search"><span>⌕</span><input aria-label="بحث بالاسم أو الكود" placeholder="ابحث باسم الصنف أو الكود..." value={query} onChange={(e) => setQuery(e.target.value)} /></label>
          <select aria-label="نوع الصنف" disabled title="نوع الصنف غير متاح في الاستجابة الحالية"><option>كل أنواع الأصناف</option></select>
          <select aria-label="التصنيف" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">كل التصنيفات</option>{categories.map((value) => <option key={value}>{value}</option>)}</select>
          <label className="low-stock-filter" title="يُطبّق عند توفر الرصيد في الاستجابة"><input type="checkbox" checked={lowStock} onChange={(e) => setLowStock(e.target.checked)} /> مخزون منخفض</label>
          {(query || category || lowStock) && <button className="clear-filters" onClick={() => { setQuery(""); setCategory(""); setLowStock(false); }}>مسح الفلاتر</button>}
        </div>
        {error && <p className="items-error">{error}</p>}
        {loading ? <p className="empty items-loading">جارٍ تحميل الأصناف...</p> : (
          <div className="items-table-wrap">
            <table className="ledger-table responsive-table items-table">
              <thead><tr><th>كود الصنف</th><th>اسم الصنف</th><th>نوع الصنف</th><th>الوحدة</th><th>الكمية الحالية</th><th>آخر شراء</th><th>سعر البيع</th><th>متوسط التكلفة</th><th>قيمة المخزون</th><th>الأرشفة</th><th>الإجراءات</th></tr></thead>
              <tbody>
                {filteredItems.map((item) => <tr key={item.id}>
                  <td data-label="كود الصنف"><span className="item-code">{item.code}</span></td>
                  <td data-label="اسم الصنف"><div className="item-name-cell"><span className="item-avatar">◇</span><span><strong>{item.name}</strong><small>{item.category || "غير مصنّف"}</small></span></div></td>
                  <td data-label="نوع الصنف"><span className="item-type-badge type-unknown"><i>◇</i> غير محدد</span></td>
                  <td data-label="الوحدة">{item.unit || "—"}</td>
                  <td data-label="الكمية الحالية" className="num">{item.quantity ?? "—"}</td>
                  <td data-label="آخر شراء" className="num">{item.lastPurchasePrice != null ? fmt2(item.lastPurchasePrice) : "—"}</td>
                  <td data-label="سعر البيع" className="num">{item.salePrice != null ? fmt2(item.salePrice) : "—"}</td>
                  <td data-label="متوسط التكلفة" className="num">{item.averageCost != null ? fmt2(item.averageCost) : "—"}</td>
                  <td data-label="قيمة المخزون" className="num">{item.stockValue != null ? fmt2(item.stockValue) : "—"}</td>
                  <td data-label="حالة الأرشفة"><span className={`archive-status ${item.isArchived ? "archived" : ""}`}><i />{item.isArchived ? "مؤرشف" : "نشط"}</span></td>
                  <td data-label="الإجراءات" className="row-actions"><div className="item-actions">
                    <ActionButton icon={Icons.view} label="عرض" onClick={() => setViewItem(item)} />
                    <ActionButton icon={Icons.edit} label="تعديل" onClick={() => startEdit(item)} />
                    <ActionButton icon={Icons.duplicate} label="نسخ الصنف" onClick={() => duplicate(item)} />
                    <ActionButton icon={Icons.archive} label="أرشفة الصنف" disabled title="الأرشفة غير متاحة في واجهة API الحالية" />
                    <ActionButton icon={Icons.remove} label="حذف" danger onClick={() => remove(item)} title="الحذف — قد يمنعه النظام إذا كان الصنف مرتبطاً بمعاملات" />
                    <ActionButton icon={Icons.print} label="طباعة بطاقة الصنف" onClick={() => { setViewItem(item); setTimeout(() => window.print(), 0); }} />
                  </div></td>
                </tr>)}
                {filteredItems.length === 0 && <tr><td className="empty items-empty" colSpan={11}><span>⌕</span><strong>لا توجد أصناف مطابقة</strong><small>جرّب تعديل معايير البحث أو الفلترة</small></td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <footer className="items-table-footer">عرض <strong>{filteredItems.length}</strong> من أصل <strong>{items.length}</strong> صنف</footer>
      </section>

      {viewItem && <div className="voucher-overlay item-view-overlay" onMouseDown={() => setViewItem(null)}><div className="voucher-shell item-view-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="item-view-head"><span className="item-avatar large">◇</span><div><small>بطاقة الصنف</small><h3>{viewItem.name}</h3><span className="item-code">{viewItem.code}</span></div></div>
        <dl><div><dt>التصنيف</dt><dd>{viewItem.category || "—"}</dd></div><div><dt>الوحدة</dt><dd>{viewItem.unit || "—"}</dd></div><div><dt>سعر التكلفة</dt><dd>{fmt2(viewItem.costPrice)}</dd></div><div><dt>حد إعادة الطلب</dt><dd>{viewItem.reorderLevel || "—"}</dd></div></dl>
        <div className="voucher-actions"><button className="btn-ghost" onClick={() => setViewItem(null)}>إغلاق</button><button className="btn-primary" onClick={() => window.print()}>طباعة البطاقة</button></div>
      </div></div>}
    </div>
  );
}
