import React, { useEffect, useMemo, useState } from "react";
import { listItems, createItem, updateItem, deleteItem, getItemComponents, setItemComponents } from "../../api/items";
import { listAccounts } from "../../api/accounts";
import { fmt2 } from "../../legacy/constants";
import AccountSearchSelect from "../shared/AccountSearchSelect";

const ITEM_TYPES = ["inventory", "expense", "service", "fixed_asset", "raw_material", "bundle"];
const STOCK_TRACKED_TYPES = ["inventory", "expense", "raw_material", "bundle"];

const TYPE_META = {
  inventory: { label: "مخزون", icon: "◈", css: "type-inventory" },
  expense: { label: "مصروف", icon: "▢", css: "type-expense" },
  service: { label: "خدمة", icon: "☆", css: "type-service" },
  fixed_asset: { label: "أصل ثابت", icon: "▣", css: "type-fixed-asset" },
  raw_material: { label: "مادة أولية", icon: "◪", css: "type-raw-material" },
  bundle: { label: "منتج مجمّع", icon: "⬡", css: "type-bundle" },
};

const ACCOUNT_LABELS = {
  stockAccountId: "حساب المخزون",
  cogsAccountId: "حساب تكلفة البضاعة المباعة",
  revenueAccountId: "حساب الإيراد",
  expenseAccountId: "حساب المصروف",
};

/** يطابق نفس القاعدة في items.schemas.ts (requiredAccountFieldsForType) — يقرّر أي حقول ربط محاسبي تظهر إلزامية حسب نوع الصنف. */
function requiredAccountFieldsForType(type, allowDirectSale) {
  switch (type) {
    case "inventory": return ["stockAccountId", "cogsAccountId", "revenueAccountId"];
    case "expense": return ["expenseAccountId"];
    case "service": return ["revenueAccountId"];
    case "raw_material": return allowDirectSale ? ["stockAccountId", "revenueAccountId", "cogsAccountId"] : ["stockAccountId"];
    case "bundle": return ["stockAccountId", "revenueAccountId", "cogsAccountId"];
    default: return [];
  }
}

const emptyForm = () => ({
  code: "", name: "", type: "inventory", unit: "", category: "",
  salePrice: "", vatApplicable: true, reorderLevel: "",
  stockAccountId: "", cogsAccountId: "", revenueAccountId: "", expenseAccountId: "",
  allowDirectSale: false, assetCategory: "",
});

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
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm());
  const [components, setComponents] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
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
  useEffect(() => { if (companyId) listAccounts({ companyId }).then(setAccounts); }, [companyId]);

  const categories = useMemo(() => [...new Set(items.map((item) => item.category).filter(Boolean))], [items]);
  const filteredItems = useMemo(() => items.filter((item) => {
    const text = query.trim().toLocaleLowerCase("ar");
    const matchesQuery = !text || item.name?.toLocaleLowerCase("ar").includes(text) || item.code?.toLocaleLowerCase("ar").includes(text);
    const matchesCategory = !category || item.category === category;
    const matchesType = !typeFilter || item.type === typeFilter;
    const matchesStock = !lowStock || (item.quantity != null && item.reorderLevel != null && Number(item.quantity) < Number(item.reorderLevel));
    const matchesStatus = status === "active" ? item.isArchived !== true : item.isArchived === true;
    return matchesQuery && matchesCategory && matchesType && matchesStock && matchesStatus;
  }), [items, query, category, typeFilter, lowStock, status]);

  const postingAccounts = (accountType) => accounts.filter((a) => a.isPosting && !a.isArchived && a.type === accountType);
  const assetAccounts = useMemo(() => postingAccounts("asset"), [accounts]);
  const revenueAccounts = useMemo(() => postingAccounts("revenue"), [accounts]);
  const expenseAccounts = useMemo(() => postingAccounts("expense"), [accounts]);

  const requiredFields = requiredAccountFieldsForType(form.type, form.allowDirectSale);
  const isSellableType = form.type === "inventory" || form.type === "service" || form.type === "bundle" || (form.type === "raw_material" && form.allowDirectSale);
  const componentOptions = useMemo(() => items.filter((i) => i.id !== editingId && i.type !== "bundle"), [items, editingId]);

  const changeType = (type) => setForm((f) => ({
    ...f, type, stockAccountId: "", cogsAccountId: "", revenueAccountId: "", expenseAccountId: "",
    allowDirectSale: false, assetCategory: "",
  }));

  const addComponent = () => setComponents((c) => [...c, { componentItemId: "", quantityPerUnit: 1 }]);
  const updateComponent = (idx, field, value) => setComponents((c) => c.map((row, i) => (i === idx ? { ...row, [field]: value } : row)));
  const removeComponent = (idx) => setComponents((c) => c.filter((_, i) => i !== idx));

  const save = async () => {
    if (!form.code.trim() || !form.name.trim()) return;
    const cleanedComponents = components
      .filter((c) => c.componentItemId && Number(c.quantityPerUnit) > 0)
      .map((c) => ({ componentItemId: c.componentItemId, quantityPerUnit: Number(c.quantityPerUnit) }));
    const payload = {
      companyId,
      code: form.code.trim(),
      name: form.name.trim(),
      type: form.type,
      unit: form.unit || undefined,
      category: form.category || undefined,
      salePrice: form.salePrice !== "" ? Number(form.salePrice) : undefined,
      vatApplicable: form.vatApplicable,
      reorderLevel: form.reorderLevel !== "" ? Number(form.reorderLevel) : undefined,
      stockAccountId: form.stockAccountId || undefined,
      cogsAccountId: form.cogsAccountId || undefined,
      revenueAccountId: form.revenueAccountId || undefined,
      expenseAccountId: form.expenseAccountId || undefined,
      allowDirectSale: form.type === "raw_material" ? form.allowDirectSale : undefined,
      assetCategory: form.type === "fixed_asset" ? (form.assetCategory || undefined) : undefined,
    };
    if (form.type === "bundle" && !editingId) payload.components = cleanedComponents;
    try {
      if (editingId) {
        await updateItem(editingId, payload);
        if (form.type === "bundle") await setItemComponents(editingId, cleanedComponents);
      } else {
        await createItem(payload);
      }
      setForm(emptyForm());
      setComponents([]);
      setEditingId(null);
      setFormOpen(false);
      reload();
    } catch (err) { setError(err.message); }
  };

  const loadComponentsFor = async (item) => {
    if (item.type !== "bundle") { setComponents([]); return; }
    try {
      const comps = await getItemComponents(item.id);
      setComponents(comps.map((c) => ({ componentItemId: c.componentItemId, quantityPerUnit: Number(c.quantityPerUnit) })));
    } catch (err) { setError(err.message); }
  };

  const startEdit = async (item) => {
    setEditingId(item.id);
    setForm({
      code: item.code, name: item.name, type: item.type, unit: item.unit || "", category: item.category || "",
      salePrice: item.salePrice ?? "", vatApplicable: item.vatApplicable, reorderLevel: item.reorderLevel ?? "",
      stockAccountId: item.stockAccountId || "", cogsAccountId: item.cogsAccountId || "",
      revenueAccountId: item.revenueAccountId || "", expenseAccountId: item.expenseAccountId || "",
      allowDirectSale: item.allowDirectSale || false, assetCategory: item.assetCategory || "",
    });
    await loadComponentsFor(item);
    setFormOpen(true);
  };

  const duplicate = async (item) => {
    setEditingId(null);
    setForm({
      code: `${item.code}-COPY`, name: `${item.name} — نسخة`, type: item.type, unit: item.unit || "", category: item.category || "",
      salePrice: item.salePrice ?? "", vatApplicable: item.vatApplicable, reorderLevel: item.reorderLevel ?? "",
      stockAccountId: item.stockAccountId || "", cogsAccountId: item.cogsAccountId || "",
      revenueAccountId: item.revenueAccountId || "", expenseAccountId: item.expenseAccountId || "",
      allowDirectSale: item.allowDirectSale || false, assetCategory: item.assetCategory || "",
    });
    await loadComponentsFor(item);
    setFormOpen(true);
  };

  const remove = async (item) => {
    if (!window.confirm(`حذف الصنف "${item.name}"؟`)) return;
    try { await deleteItem(item.id); reload(); } catch (err) { setError(err.message); }
  };

  const toggleArchive = async (item) => {
    try { await updateItem(item.id, { isArchived: !item.isArchived }); reload(); } catch (err) { setError(err.message); }
  };

  const exportItems = () => {
    const headings = ["كود الصنف", "اسم الصنف", "نوع الصنف", "الوحدة", "التصنيف", "متوسط التكلفة", "سعر البيع", "حد إعادة الطلب"];
    const rows = items.map((item) => [
      item.code, item.name, TYPE_META[item.type]?.label || item.type, item.unit || "", item.category || "",
      item.averageCost, item.salePrice ?? "", item.reorderLevel || "",
    ]);
    const csv = `﻿${[headings, ...rows].map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\n")}`;
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
          <button className="btn-primary item-add-btn" onClick={() => { setEditingId(null); setForm(emptyForm()); setComponents([]); setFormOpen(true); }}><span>{Icons.add}</span> إضافة صنف جديد</button>
          <button className="items-toolbar-btn" disabled title="استيراد الأصناف غير متاح في واجهة API الحالية"><span>{Icons.import}</span> استيراد أصناف</button>
          <button className="items-toolbar-btn" onClick={exportItems}><span>{Icons.export}</span> تصدير أصناف <small>CSV</small></button>
          <button className="items-toolbar-btn" disabled title="إدارة وحدات القياس غير متاحة في واجهة API الحالية"><span>{Icons.units}</span> وحدات القياس</button>
          <button className="items-toolbar-btn" onClick={onNavigateTransfer}><span>{Icons.transfer}</span> نقل بين المستودعات</button>
        </div>
      </header>

      {formOpen && <div className="panel form-panel items-form-panel">
        <div className="items-form-heading"><strong>{editingId ? `تعديل الصنف — ${form.name}` : "إضافة صنف جديد"}</strong><button className="item-close" onClick={() => setFormOpen(false)}>×</button></div>

        <div className="form-grid">
          <label>نوع الصنف
            <select value={form.type} onChange={(e) => changeType(e.target.value)}>
              {ITEM_TYPES.map((t) => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
            </select>
          </label>
          <label>كود الصنف<input type="text" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></label>
          <label>اسم الصنف<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>الوحدة<input type="text" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="لتر، قطعة..." /></label>
          <label>التصنيف<input type="text" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></label>
          {STOCK_TRACKED_TYPES.includes(form.type) && <label>حد إعادة الطلب<input type="number" value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} /></label>}
        </div>

        {form.type === "raw_material" && <label className="checkbox-label">
          <input type="checkbox" checked={form.allowDirectSale} onChange={(e) => setForm({ ...form, allowDirectSale: e.target.checked })} />
          يمكن بيع هذه المادة الأولية مباشرةً للعملاء
        </label>}

        {form.type === "fixed_asset" && <div className="form-grid">
          <label>تصنيف الأصل<input type="text" value={form.assetCategory} onChange={(e) => setForm({ ...form, assetCategory: e.target.value })} placeholder="مثال: أثاث، سيارات..." /></label>
        </div>}
        {form.type === "fixed_asset" && <p className="note">حسابات الأصول الثابتة تُحدَّد تلقائياً على مستوى الشركة، ولا تحتاج ربطاً هنا؛ عمر الأصل وقيمة الخردة يُدخَلان لاحقاً في سطر فاتورة الشراء.</p>}

        {isSellableType && <div className="form-grid">
          <label>سعر البيع المقترح<input type="number" value={form.salePrice} onChange={(e) => setForm({ ...form, salePrice: e.target.value })} placeholder="0.00" /></label>
          <label className="checkbox-label"><input type="checkbox" checked={form.vatApplicable} onChange={(e) => setForm({ ...form, vatApplicable: e.target.checked })} /> خاضع لضريبة القيمة المضافة</label>
        </div>}

        {requiredFields.length > 0 && <div className="form-grid items-accounts-grid">
          {requiredFields.includes("stockAccountId") && <label>{ACCOUNT_LABELS.stockAccountId}
            <AccountSearchSelect accounts={assetAccounts} value={form.stockAccountId} onChange={(id) => setForm({ ...form, stockAccountId: id })} />
          </label>}
          {requiredFields.includes("cogsAccountId") && <label>{ACCOUNT_LABELS.cogsAccountId}
            <AccountSearchSelect accounts={expenseAccounts} value={form.cogsAccountId} onChange={(id) => setForm({ ...form, cogsAccountId: id })} />
          </label>}
          {requiredFields.includes("revenueAccountId") && <label>{ACCOUNT_LABELS.revenueAccountId}
            <AccountSearchSelect accounts={revenueAccounts} value={form.revenueAccountId} onChange={(id) => setForm({ ...form, revenueAccountId: id })} />
          </label>}
          {requiredFields.includes("expenseAccountId") && <label>{ACCOUNT_LABELS.expenseAccountId}
            <AccountSearchSelect accounts={expenseAccounts} value={form.expenseAccountId} onChange={(id) => setForm({ ...form, expenseAccountId: id })} />
          </label>}
        </div>}

        {form.type === "bundle" && <div className="bom-editor">
          <div className="bom-editor-head"><strong>مكوّنات المنتج (BOM)</strong><button type="button" className="btn-ghost" onClick={addComponent}>+ إضافة مكوّن</button></div>
          <table className="ledger-table bom-table">
            <thead><tr><th>المكوّن</th><th>الكمية لكل وحدة</th><th></th></tr></thead>
            <tbody>
              {components.map((c, idx) => <tr key={idx}>
                <td>
                  <select value={c.componentItemId} onChange={(e) => updateComponent(idx, "componentItemId", e.target.value)}>
                    <option value="">— اختر صنفاً —</option>
                    {componentOptions.map((it) => <option key={it.id} value={it.id}>{it.name} ({it.code})</option>)}
                  </select>
                </td>
                <td><input type="number" min="0" step="0.01" value={c.quantityPerUnit} onChange={(e) => updateComponent(idx, "quantityPerUnit", e.target.value)} /></td>
                <td><button type="button" className="btn-remove-line" onClick={() => removeComponent(idx)}>✕</button></td>
              </tr>)}
              {components.length === 0 && <tr><td className="empty" colSpan={3}>أضف مكوّناً واحداً على الأقل</td></tr>}
            </tbody>
          </table>
        </div>}

        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group"><button className="btn-ghost" onClick={() => setFormOpen(false)}>إلغاء</button><button className="btn-primary" onClick={save}>{editingId ? "حفظ التعديلات" : "حفظ الصنف"}</button></div>
      </div>}

      <section className="panel items-directory-panel">
        <div className="items-tabs" role="tablist">
          <button className={status === "active" ? "active" : ""} onClick={() => setStatus("active")}>نشط <span>{items.filter((i) => i.isArchived !== true).length}</span></button>
          <button className={status === "archived" ? "active" : ""} onClick={() => setStatus("archived")}>مؤرشف <span>{items.filter((i) => i.isArchived === true).length}</span></button>
        </div>
        <div className="items-filters">
          <label className="items-search"><span>⌕</span><input aria-label="بحث بالاسم أو الكود" placeholder="ابحث باسم الصنف أو الكود..." value={query} onChange={(e) => setQuery(e.target.value)} /></label>
          <select aria-label="نوع الصنف" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">كل أنواع الأصناف</option>
            {ITEM_TYPES.map((t) => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
          </select>
          <select aria-label="التصنيف" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">كل التصنيفات</option>{categories.map((value) => <option key={value}>{value}</option>)}</select>
          <label className="low-stock-filter"><input type="checkbox" checked={lowStock} onChange={(e) => setLowStock(e.target.checked)} /> مخزون منخفض</label>
          {(query || category || typeFilter || lowStock) && <button className="clear-filters" onClick={() => { setQuery(""); setCategory(""); setTypeFilter(""); setLowStock(false); }}>مسح الفلاتر</button>}
        </div>
        {error && !formOpen && <p className="items-error">{error}</p>}
        {loading ? <p className="empty items-loading">جارٍ تحميل الأصناف...</p> : (
          <div className="items-table-wrap">
            <table className="ledger-table responsive-table items-table">
              <thead><tr><th>كود الصنف</th><th>اسم الصنف</th><th>نوع الصنف</th><th>الوحدة</th><th>الكمية الحالية</th><th>آخر شراء</th><th>سعر البيع</th><th>متوسط التكلفة</th><th>قيمة المخزون</th><th>الأرشفة</th><th>الإجراءات</th></tr></thead>
              <tbody>
                {filteredItems.map((item) => <tr key={item.id}>
                  <td data-label="كود الصنف"><span className="item-code">{item.code}</span></td>
                  <td data-label="اسم الصنف"><div className="item-name-cell"><span className="item-avatar">◇</span><span><strong>{item.name}</strong><small>{item.category || "غير مصنّف"}</small></span></div></td>
                  <td data-label="نوع الصنف"><span className={`item-type-badge ${TYPE_META[item.type]?.css || "type-unknown"}`}><i>{TYPE_META[item.type]?.icon || "◇"}</i> {TYPE_META[item.type]?.label || "غير محدد"}</span></td>
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
                    <ActionButton icon={Icons.archive} label={item.isArchived ? "إلغاء الأرشفة" : "أرشفة الصنف"} onClick={() => toggleArchive(item)} />
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
        <div className="item-view-head"><span className="item-avatar large">{TYPE_META[viewItem.type]?.icon || "◇"}</span><div><small>بطاقة الصنف — {TYPE_META[viewItem.type]?.label || "غير محدد"}</small><h3>{viewItem.name}</h3><span className="item-code">{viewItem.code}</span></div></div>
        <dl>
          <div><dt>التصنيف</dt><dd>{viewItem.category || "—"}</dd></div>
          <div><dt>الوحدة</dt><dd>{viewItem.unit || "—"}</dd></div>
          <div><dt>متوسط التكلفة</dt><dd>{fmt2(viewItem.averageCost || 0)}</dd></div>
          <div><dt>سعر البيع</dt><dd>{viewItem.salePrice != null ? fmt2(viewItem.salePrice) : "—"}</dd></div>
          <div><dt>حد إعادة الطلب</dt><dd>{viewItem.reorderLevel || "—"}</dd></div>
          <div><dt>الكمية الحالية</dt><dd>{viewItem.quantity ?? "—"}</dd></div>
        </dl>
        <div className="voucher-actions"><button className="btn-ghost" onClick={() => setViewItem(null)}>إغلاق</button><button className="btn-primary" onClick={() => window.print()}>طباعة البطاقة</button></div>
      </div></div>}
    </div>
  );
}
