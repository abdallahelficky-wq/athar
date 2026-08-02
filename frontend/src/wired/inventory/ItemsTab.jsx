import React, { useEffect, useMemo, useState } from "react";
import { listItems, createItem, updateItem, deleteItem } from "../../api/items";
import { fmt2 } from "../../legacy/constants";
import { downloadCsv, Icon } from "../../legacy/shared";

const emptyForm = () => ({ code: "", name: "", unit: "", category: "", costPrice: "", reorderLevel: "" });
const unavailable = <span className="items-unavailable" title="هذه البيانات غير متاحة في استجابة API الحالية">—</span>;

export default function ItemsTab({ companyId, onNavigateTransfer }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [statusTab, setStatusTab] = useState("active");
  const [viewItem, setViewItem] = useState(null);

  const reload = () => {
    if (!companyId) return;
    setLoading(true);
    listItems(companyId).then(setItems).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(reload, [companyId]);

  const categories = useMemo(() => [...new Set(items.map((item) => item.category).filter(Boolean))].sort(), [items]);
  const visibleItems = useMemo(() => items.filter((item) => {
    const needle = query.trim().toLocaleLowerCase("ar");
    const matchesSearch = !needle || item.name.toLocaleLowerCase("ar").includes(needle) || item.code.toLocaleLowerCase("ar").includes(needle);
    return statusTab === "active" && matchesSearch && (!category || item.category === category);
  }), [items, query, category, statusTab]);

  const save = async () => {
    if (!form.code.trim() || !form.name.trim()) return;
    try {
      const payload = { ...form, companyId, costPrice: Number(form.costPrice || 0), reorderLevel: form.reorderLevel || undefined };
      if (editingId) await updateItem(editingId, payload);
      else await createItem(payload);
      setForm(emptyForm());
      setEditingId(null);
      setShowForm(false);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    setForm({ ...emptyForm(), ...item, costPrice: item.costPrice, reorderLevel: item.reorderLevel || "" });
    setShowForm(true);
  };
  const cancelForm = () => { setEditingId(null); setForm(emptyForm()); setShowForm(false); };
  const remove = async (item) => {
    if (!window.confirm(`حذف الصنف "${item.name}"؟`)) return;
    try {
      await deleteItem(item.id);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };
  const exportItems = () => downloadCsv("الأصناف.csv", [
    ["كود الصنف", "اسم الصنف", "الوحدة", "التصنيف", "سعر التكلفة المسجل", "حد إعادة الطلب"],
    ...visibleItems.map((item) => [item.code, item.name, item.unit || "", item.category || "", item.costPrice || 0, item.reorderLevel || ""]),
  ]);

  if (!companyId) return <p className="empty">أنشئ شركة أولاً من لوحة القيادة.</p>;

  return (
    <div className="items-directory">
      <div className="items-page-head">
        <div>
          <span className="items-eyebrow">دليل الأصناف</span>
          <h3>الأصناف والمنتجات</h3>
          <p>إدارة بيانات الأصناف الأساسية من مكان واحد.</p>
        </div>
        <div className="items-toolbar" aria-label="إجراءات الأصناف">
          <button type="button" className="btn-primary items-add-btn" onClick={() => { setEditingId(null); setForm(emptyForm()); setShowForm(true); }}>＋ إضافة صنف جديد</button>
          <button type="button" className="btn-ghost" disabled title="استيراد الأصناف غير متاح في API الحالي">⇧ استيراد أصناف</button>
          <button type="button" className="btn-ghost" onClick={exportItems} disabled={!visibleItems.length}><Icon.Download /> تصدير أصناف</button>
          <button type="button" className="btn-ghost" disabled title="لا توجد شاشة أو API مستقل لوحدات القياس حالياً">▦ وحدات القياس</button>
          <button type="button" className="btn-ghost" onClick={onNavigateTransfer}>⇄ نقل بين المستودعات</button>
        </div>
      </div>

      {showForm && <div className="panel form-panel items-form-panel">
        <div className="items-form-heading">
          <div><strong>{editingId ? "تعديل الصنف" : "إضافة صنف جديد"}</strong><span>الحقول المعروضة هي الحقول المتاحة حالياً فقط.</span></div>
          <button type="button" className="icon-btn" onClick={cancelForm} aria-label="إغلاق">×</button>
        </div>
        <div className="form-grid">
          <label>كود الصنف<input type="text" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></label>
          <label>اسم الصنف<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>الوحدة<input type="text" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="لتر، قطعة..." /></label>
          <label>التصنيف<input type="text" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></label>
          <label>سعر التكلفة المسجل<input type="number" value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} /></label>
          <label>حد إعادة الطلب<input type="number" value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} /></label>
        </div>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          <button type="button" className="btn-ghost" onClick={cancelForm}>إلغاء</button>
          <button type="button" className="btn-primary" onClick={save}>{editingId ? "حفظ التعديلات" : "حفظ الصنف"}</button>
        </div>
      </div>}

      <div className="panel items-list-panel">
        <div className="items-status-tabs" role="tablist" aria-label="حالة الأصناف">
          <button type="button" className={statusTab === "active" ? "active" : ""} onClick={() => setStatusTab("active")}>نشط <span>{items.length}</span></button>
          <button type="button" className={statusTab === "archived" ? "active" : ""} onClick={() => setStatusTab("archived")} title="حالة الأرشفة غير متاحة في API الحالي">مؤرشف <span>—</span></button>
        </div>

        <div className="items-filters">
          <label className="items-search"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="بحث بالاسم أو الكود..." /></label>
          <select disabled title="نوع الصنف غير متاح في API الحالي"><option>كل أنواع الأصناف</option></select>
          <select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">كل التصنيفات</option>{categories.map((value) => <option key={value}>{value}</option>)}</select>
          <label className="items-low-stock is-disabled" title="الكمية الحالية غير متاحة في API الحالي"><input type="checkbox" disabled /> مخزون منخفض</label>
          <span className="items-results">{visibleItems.length} صنف</span>
        </div>

        <p className="items-data-note">الكمية، أسعار الشراء والبيع، متوسط التكلفة، قيمة المخزون، النوع والأرشفة غير موجودة في استجابة الأصناف الحالية؛ لذلك تظهر كـ «—» بدون افتراض بيانات أو إضافة API جديد.</p>
        {error && !showForm && <p className="balance-bad">{error}</p>}

        {loading ? <p className="empty">جارٍ تحميل الأصناف...</p> : (
          <div className="items-table-wrap">
            <table className="ledger-table items-table">
              <thead><tr><th>كود الصنف</th><th>اسم الصنف</th><th>نوع الصنف</th><th>الوحدة</th><th>الكمية الحالية</th><th>آخر شراء</th><th>سعر البيع</th><th>متوسط التكلفة</th><th>قيمة المخزون</th><th>الأرشفة</th><th>الإجراءات</th></tr></thead>
              <tbody>
                {visibleItems.map((item) => (
                  <tr key={item.id}>
                    <td data-label="كود الصنف"><span className="items-code">{item.code}</span></td>
                    <td data-label="اسم الصنف"><div className="items-name"><span className="items-kind-icon">◇</span><div><strong>{item.name}</strong>{item.category && <small>{item.category}</small>}</div></div></td>
                    <td data-label="نوع الصنف"><span className="item-type-badge type-unknown">غير محدد</span></td>
                    <td data-label="الوحدة">{item.unit || "—"}</td>
                    <td data-label="الكمية الحالية" className="num">{unavailable}</td>
                    <td data-label="آخر شراء" className="num">{unavailable}</td>
                    <td data-label="سعر البيع" className="num">{unavailable}</td>
                    <td data-label="متوسط التكلفة" className="num">{unavailable}</td>
                    <td data-label="قيمة المخزون" className="num">{unavailable}</td>
                    <td data-label="الأرشفة"><span className="item-archive-badge">غير متاح</span></td>
                    <td data-label="الإجراءات" className="row-actions items-row-actions">
                      <button type="button" className="icon-btn" title="عرض بيانات الصنف" onClick={() => setViewItem(item)}><Icon.Eye /></button>
                      <button type="button" className="icon-btn" title="تعديل" onClick={() => startEdit(item)}><Icon.Edit /></button>
                      <button type="button" className="icon-btn" title="النسخ غير مدعوم كإجراء مستقل في API الحالي" disabled><Icon.Copy /></button>
                      <button type="button" className="icon-btn" title="الأرشفة غير متاحة في نموذج الصنف الحالي" disabled><Icon.Lock /></button>
                      <button type="button" className="icon-btn icon-btn-danger" title="سيمنع الخادم الحذف إذا كان الصنف مرتبطاً بمعاملات" onClick={() => remove(item)}><Icon.Trash /></button>
                      <button type="button" className="icon-btn" title="طباعة بطاقة الصنف غير متاحة في API الحالي" disabled><Icon.Printer /></button>
                    </td>
                  </tr>
                ))}
                {visibleItems.length === 0 && <tr className="items-empty-row"><td className="empty" colSpan={11}>{statusTab === "archived" ? "بيانات الأرشفة غير متاحة في API الحالي." : "لا توجد أصناف مطابقة للفلاتر."}</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {viewItem && <div className="items-detail-overlay" role="dialog" aria-modal="true" aria-label="تفاصيل الصنف" onMouseDown={() => setViewItem(null)}>
        <div className="items-detail-card" onMouseDown={(event) => event.stopPropagation()}>
          <button type="button" className="icon-btn items-detail-close" onClick={() => setViewItem(null)}>×</button>
          <span className="items-kind-icon large">◇</span><span className="items-code">{viewItem.code}</span><h3>{viewItem.name}</h3>
          <dl><div><dt>التصنيف</dt><dd>{viewItem.category || "—"}</dd></div><div><dt>الوحدة</dt><dd>{viewItem.unit || "—"}</dd></div><div><dt>سعر التكلفة المسجل</dt><dd>{fmt2(viewItem.costPrice)}</dd></div><div><dt>حد إعادة الطلب</dt><dd>{viewItem.reorderLevel || "—"}</dd></div></dl>
          <button type="button" className="btn-primary" onClick={() => { setViewItem(null); startEdit(viewItem); }}>تعديل الصنف</button>
        </div>
      </div>}
    </div>
  );
}
