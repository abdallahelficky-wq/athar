import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { listItems, createItem, updateItem, deleteItem, getItemComponents, setItemComponents } from "../../api/items";
import { listAccounts } from "../../api/accounts";
import { listAssetCategories } from "../../api/assetCategories";
import { fmt2 } from "../../legacy/constants";
import AccountSearchSelect from "../shared/AccountSearchSelect";
import { useDeferredFilters } from "../shared/useDeferredFilters";

const emptyItemFilters = { query: "", category: "", typeFilter: "", lowStock: false };

const ITEM_TYPES = ["inventory", "expense", "service", "fixed_asset", "raw_material", "bundle"];
const STOCK_TRACKED_TYPES = ["inventory", "expense", "raw_material", "bundle"];

const TYPE_CSS = {
  inventory: "type-inventory", expense: "type-expense", service: "type-service",
  fixed_asset: "type-fixed-asset", raw_material: "type-raw-material", bundle: "type-bundle",
};
const TYPE_ICON = {
  inventory: "◈", expense: "▢", service: "☆", fixed_asset: "▣", raw_material: "◪", bundle: "⬡",
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
  code: "", name: "", barcode: "", type: "inventory", unit: "", category: "",
  salePrice: "", vatApplicable: true, reorderLevel: "",
  stockAccountId: "", cogsAccountId: "", revenueAccountId: "", expenseAccountId: "",
  allowDirectSale: false, assetCategoryId: "",
});

const Icons = {
  add: "＋", import: "⇧", export: "⇩", units: "▦", transfer: "⇄", columns: "☰",
  view: "◉", edit: "✎", duplicate: "▣", archive: "▾", remove: "×", print: "▤",
};

// أعمدة ثانوية (أقل أهمية للتصفح اليومي) — مخفيّة افتراضياً لتقليل ازدحام الجدول وتفادي السكرول
// الأفقي، ويختار المستخدم إظهارها عبر زرار "الأعمدة"؛ يُحفَظ الاختيار محلياً كتفضيل شخصي دائم.
const EXTRA_COLUMNS = ["lastPurchasePrice", "averageCost", "stockValue"];
const COLUMN_PREFS_KEY = "athar.itemsTable.extraColumns";
const loadColumnPrefs = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(COLUMN_PREFS_KEY) || "{}");
    return Object.fromEntries(EXTRA_COLUMNS.map((c) => [c, saved[c] || false]));
  } catch {
    return Object.fromEntries(EXTRA_COLUMNS.map((c) => [c, false]));
  }
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
  const { t } = useTranslation();
  const TYPE_LABEL = t("inventory.typeMeta", { returnObjects: true });
  const ACCOUNT_LABELS = t("inventory.accountLabels", { returnObjects: true });
  const EXTRA_COLUMN_LABELS = t("inventory.items.extraColumns", { returnObjects: true });

  const [items, setItems] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [assetCategories, setAssetCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm());
  const [components, setComponents] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const itemFilters = useDeferredFilters(emptyItemFilters);
  const [status, setStatus] = useState("active");
  const [viewItem, setViewItem] = useState(null);
  const [extraColumns, setExtraColumns] = useState(loadColumnPrefs);
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);

  const toggleColumn = (key) => setExtraColumns((prev) => {
    const next = { ...prev, [key]: !prev[key] };
    localStorage.setItem(COLUMN_PREFS_KEY, JSON.stringify(next));
    return next;
  });

  const reload = () => {
    if (!companyId) return;
    setLoading(true);
    setError("");
    listItems(companyId).then(setItems).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(reload, [companyId]);
  useEffect(() => { if (companyId) listAccounts({ companyId }).then(setAccounts); }, [companyId]);
  useEffect(() => { if (companyId) listAssetCategories(companyId).then(setAssetCategories); }, [companyId]);

  const categories = useMemo(() => [...new Set(items.map((item) => item.category).filter(Boolean))], [items]);
  const filteredItems = useMemo(() => {
    const f = itemFilters.applied;
    const text = f.query.trim().toLocaleLowerCase("ar");
    return items.filter((item) => {
      const matchesQuery = !text || item.name?.toLocaleLowerCase("ar").includes(text) || item.code?.toLocaleLowerCase("ar").includes(text);
      const matchesCategory = !f.category || item.category === f.category;
      const matchesType = !f.typeFilter || item.type === f.typeFilter;
      const matchesStock = !f.lowStock || (item.quantity != null && item.reorderLevel != null && Number(item.quantity) < Number(item.reorderLevel));
      const matchesStatus = status === "active" ? item.isArchived !== true : item.isArchived === true;
      return matchesQuery && matchesCategory && matchesType && matchesStock && matchesStatus;
    });
  }, [items, itemFilters.applied, status]);

  // عمود "الكمية الحالية" لا معنى له إطلاقاً عند فلترة النوع على "خدمي" وحده (لا تتبّع مخزون لها
  // بالمرة)، فيُخفى العمود بالكامل في هذه الحالة بدل عرض "—" في كل صف.
  const showQuantityColumn = itemFilters.applied.typeFilter !== "service";
  const columnCount = 4 // كود، اسم، نوع، وحدة
    + (showQuantityColumn ? 1 : 0)
    + (extraColumns.lastPurchasePrice ? 1 : 0)
    + 1 // سعر البيع
    + (extraColumns.averageCost ? 1 : 0)
    + (extraColumns.stockValue ? 1 : 0)
    + 1; // الإجراءات

  const postingAccounts = (accountType) => accounts.filter((a) => a.isPosting && !a.isArchived && a.type === accountType);
  const assetAccounts = useMemo(() => postingAccounts("asset"), [accounts]);
  const revenueAccounts = useMemo(() => postingAccounts("revenue"), [accounts]);
  const expenseAccounts = useMemo(() => postingAccounts("expense"), [accounts]);
  const groupedAssetCategories = useMemo(
    () => assetCategories.reduce((acc, c) => { (acc[c.groupName] = acc[c.groupName] || []).push(c); return acc; }, {}),
    [assetCategories],
  );

  const requiredFields = requiredAccountFieldsForType(form.type, form.allowDirectSale);
  const isSellableType = form.type === "inventory" || form.type === "service" || form.type === "bundle" || (form.type === "raw_material" && form.allowDirectSale);
  const componentOptions = useMemo(() => items.filter((i) => i.id !== editingId && i.type !== "bundle"), [items, editingId]);

  const changeType = (type) => setForm((f) => ({
    ...f, type, stockAccountId: "", cogsAccountId: "", revenueAccountId: "", expenseAccountId: "",
    allowDirectSale: false, assetCategoryId: "",
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
      barcode: form.barcode.trim() || undefined,
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
      assetCategoryId: form.type === "fixed_asset" ? (form.assetCategoryId || undefined) : undefined,
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
      code: item.code, name: item.name, barcode: item.barcode || "", type: item.type, unit: item.unit || "", category: item.category || "",
      salePrice: item.salePrice ?? "", vatApplicable: item.vatApplicable, reorderLevel: item.reorderLevel ?? "",
      stockAccountId: item.stockAccountId || "", cogsAccountId: item.cogsAccountId || "",
      revenueAccountId: item.revenueAccountId || "", expenseAccountId: item.expenseAccountId || "",
      allowDirectSale: item.allowDirectSale || false, assetCategoryId: item.assetCategoryId || "",
    });
    await loadComponentsFor(item);
    setFormOpen(true);
  };

  const duplicate = async (item) => {
    setEditingId(null);
    setForm({
      code: `${item.code}-COPY`, name: `${item.name} — ${t("inventory.items.duplicateSuffix")}`, barcode: "", type: item.type, unit: item.unit || "", category: item.category || "",
      salePrice: item.salePrice ?? "", vatApplicable: item.vatApplicable, reorderLevel: item.reorderLevel ?? "",
      stockAccountId: item.stockAccountId || "", cogsAccountId: item.cogsAccountId || "",
      revenueAccountId: item.revenueAccountId || "", expenseAccountId: item.expenseAccountId || "",
      allowDirectSale: item.allowDirectSale || false, assetCategoryId: item.assetCategoryId || "",
    });
    await loadComponentsFor(item);
    setFormOpen(true);
  };

  const remove = async (item) => {
    if (!window.confirm(t("inventory.items.confirmDelete", { name: item.name }))) return;
    try { await deleteItem(item.id); reload(); } catch (err) { setError(err.message); }
  };

  const toggleArchive = async (item) => {
    try { await updateItem(item.id, { isArchived: !item.isArchived }); reload(); } catch (err) { setError(err.message); }
  };

  const exportItems = () => {
    const csvHeaders = t("inventory.items.csvHeaders", { returnObjects: true });
    const headings = [csvHeaders.code, csvHeaders.name, csvHeaders.type, csvHeaders.unit, csvHeaders.category, csvHeaders.averageCost, csvHeaders.salePrice, csvHeaders.reorderLevel];
    const rows = items.map((item) => [
      item.code, item.name, TYPE_LABEL[item.type] || item.type, item.unit || "", item.category || "",
      item.averageCost, item.salePrice ?? "", item.reorderLevel || "",
    ]);
    const csv = `﻿${[headings, ...rows].map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\n")}`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = t("inventory.items.exportFileName");
    link.click();
    URL.revokeObjectURL(link.href);
  };

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  return (
    <div className="items-page">
      <div className="items-toolbar-row">
        <button className="btn-primary item-add-btn" onClick={() => { setEditingId(null); setForm(emptyForm()); setComponents([]); setFormOpen(true); }}><span>{Icons.add}</span> {t("inventory.items.addNew")}</button>
        <button className="items-toolbar-btn" disabled title={t("inventory.items.importDisabled")}><span>{Icons.import}</span> {t("inventory.items.importBtn")}</button>
        <button className="items-toolbar-btn" onClick={exportItems}><span>{Icons.export}</span> {t("inventory.items.exportBtn")} <small>CSV</small></button>
        <button className="items-toolbar-btn" disabled title={t("inventory.items.unitsDisabled")}><span>{Icons.units}</span> {t("inventory.items.unitsBtn")}</button>
        <button className="items-toolbar-btn" onClick={onNavigateTransfer}><span>{Icons.transfer}</span> {t("inventory.items.transferBtn")}</button>
        <div className="column-toggle">
          <button className="items-toolbar-btn" onClick={() => setColumnMenuOpen((v) => !v)}><span>{Icons.columns}</span> {t("inventory.items.columnsBtn")}</button>
          {columnMenuOpen && (
            <div className="column-toggle-menu" onMouseLeave={() => setColumnMenuOpen(false)}>
              <p className="column-toggle-title">{t("inventory.items.columnsMenuTitle")}</p>
              {EXTRA_COLUMNS.map((c) => (
                <label key={c} className="column-toggle-item">
                  <input type="checkbox" checked={extraColumns[c]} onChange={() => toggleColumn(c)} />
                  {EXTRA_COLUMN_LABELS[c]}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {formOpen && <div className="panel form-panel items-form-panel">
        <div className="items-form-heading"><strong>{editingId ? t("inventory.items.form.titleEdit", { name: form.name }) : t("inventory.items.form.titleCreate")}</strong><button className="item-close" onClick={() => setFormOpen(false)}>×</button></div>

        <div className="form-grid">
          <label>{t("inventory.items.form.type")}
            <select value={form.type} onChange={(e) => changeType(e.target.value)}>
              {ITEM_TYPES.map((tp) => <option key={tp} value={tp}>{TYPE_LABEL[tp]}</option>)}
            </select>
          </label>
          <label>{t("inventory.items.form.code")}<input type="text" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></label>
          <label>{t("inventory.items.form.name")}<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>{t("inventory.items.form.barcode")}<input type="text" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} /></label>
          <label>{t("inventory.items.form.unit")}<input type="text" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder={t("inventory.items.form.unitPlaceholder")} /></label>
          <label>{t("inventory.items.form.category")}<input type="text" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></label>
          {STOCK_TRACKED_TYPES.includes(form.type) && <label>{t("inventory.items.form.reorderLevel")}<input type="number" value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} /></label>}
        </div>

        {form.type === "raw_material" && <label className="checkbox-label">
          <input type="checkbox" checked={form.allowDirectSale} onChange={(e) => setForm({ ...form, allowDirectSale: e.target.checked })} />
          {t("inventory.items.form.allowDirectSale")}
        </label>}

        {form.type === "fixed_asset" && <div className="form-grid">
          <label>{t("inventory.items.form.assetCategory")}
            <select value={form.assetCategoryId} onChange={(e) => setForm({ ...form, assetCategoryId: e.target.value })}>
              <option value="">{t("inventory.items.form.noCategoryYet")}</option>
              {Object.entries(groupedAssetCategories).map(([groupName, cats]) => (
                <optgroup key={groupName} label={groupName}>
                  {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
        </div>}
        {form.type === "fixed_asset" && <p className="note">{t("inventory.items.form.assetCategoryNote")}</p>}

        {isSellableType && <div className="form-grid">
          <label>{t("inventory.items.form.salePrice")}<input type="number" value={form.salePrice} onChange={(e) => setForm({ ...form, salePrice: e.target.value })} placeholder="0.00" /></label>
          <label className="checkbox-label"><input type="checkbox" checked={form.vatApplicable} onChange={(e) => setForm({ ...form, vatApplicable: e.target.checked })} /> {t("inventory.items.form.vatApplicable")}</label>
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
          <div className="bom-editor-head"><strong>{t("inventory.items.form.bom.title")}</strong><button type="button" className="btn-ghost" onClick={addComponent}>{t("inventory.items.form.bom.addComponent")}</button></div>
          <table className="ledger-table bom-table">
            <thead><tr><th>{t("inventory.items.form.bom.component")}</th><th>{t("inventory.items.form.bom.quantityPerUnit")}</th><th></th></tr></thead>
            <tbody>
              {components.map((c, idx) => <tr key={idx}>
                <td>
                  <select value={c.componentItemId} onChange={(e) => updateComponent(idx, "componentItemId", e.target.value)}>
                    <option value="">{t("inventory.items.form.bom.chooseItem")}</option>
                    {componentOptions.map((it) => <option key={it.id} value={it.id}>{it.name} ({it.code})</option>)}
                  </select>
                </td>
                <td><input type="number" min="0" step="0.01" value={c.quantityPerUnit} onChange={(e) => updateComponent(idx, "quantityPerUnit", e.target.value)} /></td>
                <td><button type="button" className="btn-remove-line" onClick={() => removeComponent(idx)}>✕</button></td>
              </tr>)}
              {components.length === 0 && <tr><td className="empty" colSpan={3}>{t("inventory.items.form.bom.emptyHint")}</td></tr>}
            </tbody>
          </table>
        </div>}

        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group"><button className="btn-ghost" onClick={() => setFormOpen(false)}>{t("inventory.items.form.cancel")}</button><button className="btn-primary" onClick={save}>{editingId ? t("inventory.items.form.saveChanges") : t("inventory.items.form.saveItem")}</button></div>
      </div>}

      <section className="panel items-directory-panel">
        <div className="items-tabs" role="tablist">
          <button className={status === "active" ? "active" : ""} onClick={() => setStatus("active")}>{t("inventory.items.tabActive")} <span>{items.filter((i) => i.isArchived !== true).length}</span></button>
          <button className={status === "archived" ? "active" : ""} onClick={() => setStatus("archived")}>{t("inventory.items.tabArchived")} <span>{items.filter((i) => i.isArchived === true).length}</span></button>
        </div>
        <form className="items-filters" onSubmit={(e) => { e.preventDefault(); itemFilters.apply(); }}>
          <label className="items-search"><span>⌕</span><input aria-label={t("inventory.items.filters.searchAria")} placeholder={t("inventory.items.filters.searchPlaceholder")} value={itemFilters.draft.query} onChange={(e) => itemFilters.setField("query", e.target.value)} /></label>
          <select aria-label={t("inventory.items.filters.typeAria")} value={itemFilters.draft.typeFilter} onChange={(e) => itemFilters.setField("typeFilter", e.target.value)}>
            <option value="">{t("inventory.items.filters.allTypes")}</option>
            {ITEM_TYPES.map((tp) => <option key={tp} value={tp}>{TYPE_LABEL[tp]}</option>)}
          </select>
          <select aria-label={t("inventory.items.filters.categoryAria")} value={itemFilters.draft.category} onChange={(e) => itemFilters.setField("category", e.target.value)}><option value="">{t("inventory.items.filters.allCategories")}</option>{categories.map((value) => <option key={value}>{value}</option>)}</select>
          <label className="low-stock-filter"><input type="checkbox" checked={itemFilters.draft.lowStock} onChange={(e) => itemFilters.setField("lowStock", e.target.checked)} /> {t("inventory.items.filters.lowStock")}</label>
          {Object.values(itemFilters.draft).some((v) => v !== "" && v !== false) && (
            <button type="button" className="clear-filters" onClick={() => itemFilters.reset(emptyItemFilters)}>{t("inventory.items.filters.clearFilters")}</button>
          )}
          <button type="submit" className="btn-primary">{t("inventory.items.filters.showResults")}</button>
        </form>
        {error && !formOpen && <p className="items-error">{error}</p>}
        {loading ? <p className="empty items-loading">{t("inventory.items.loading")}</p> : (
          <div className="items-table-wrap">
            <table className="ledger-table responsive-table items-table">
              <thead>
                <tr>
                  <th>{t("inventory.items.table.code")}</th>
                  <th>{t("inventory.items.table.name")}</th>
                  <th>{t("inventory.items.table.type")}</th>
                  <th>{t("inventory.items.table.unit")}</th>
                  {showQuantityColumn && <th>{t("inventory.items.table.quantity")}</th>}
                  {extraColumns.lastPurchasePrice && <th>{t("inventory.items.table.lastPurchasePrice")}</th>}
                  <th>{t("inventory.items.table.salePrice")}</th>
                  {extraColumns.averageCost && <th>{t("inventory.items.table.averageCost")}</th>}
                  {extraColumns.stockValue && <th>{t("inventory.items.table.stockValue")}</th>}
                  <th>{t("inventory.items.table.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => <tr key={item.id}>
                  <td data-label={t("inventory.items.table.code")}><span className="item-code">{item.code}</span></td>
                  <td data-label={t("inventory.items.table.name")}><div className="item-name-cell"><span className="item-avatar">◇</span><span><strong>{item.name}</strong><small>{item.category || t("inventory.items.notCategorized")}</small></span></div></td>
                  <td data-label={t("inventory.items.table.type")}><span className={`item-type-badge ${TYPE_CSS[item.type] || "type-unknown"}`}><i>{TYPE_ICON[item.type] || "◇"}</i> {TYPE_LABEL[item.type] || t("inventory.items.unspecifiedType")}</span></td>
                  <td data-label={t("inventory.items.table.unit")}>{item.unit || "—"}</td>
                  {showQuantityColumn && <td data-label={t("inventory.items.table.quantity")} className="num">{item.quantity ?? "—"}</td>}
                  {extraColumns.lastPurchasePrice && <td data-label={t("inventory.items.table.lastPurchasePrice")} className="num">{item.lastPurchasePrice != null ? fmt2(item.lastPurchasePrice) : "—"}</td>}
                  <td data-label={t("inventory.items.table.salePrice")} className="num">{item.salePrice != null ? fmt2(item.salePrice) : "—"}</td>
                  {extraColumns.averageCost && <td data-label={t("inventory.items.table.averageCost")} className="num">{item.averageCost != null ? fmt2(item.averageCost) : "—"}</td>}
                  {extraColumns.stockValue && <td data-label={t("inventory.items.table.stockValue")} className="num">{item.stockValue != null ? fmt2(item.stockValue) : "—"}</td>}
                  <td data-label={t("inventory.items.table.actions")} className="row-actions"><div className="item-actions">
                    <ActionButton icon={Icons.view} label={t("inventory.items.actions.view")} onClick={() => setViewItem(item)} />
                    <ActionButton icon={Icons.edit} label={t("inventory.items.actions.edit")} onClick={() => startEdit(item)} />
                    <ActionButton icon={Icons.duplicate} label={t("inventory.items.actions.duplicate")} onClick={() => duplicate(item)} />
                    <ActionButton icon={Icons.archive} label={item.isArchived ? t("inventory.items.actions.unarchive") : t("inventory.items.actions.archive")} onClick={() => toggleArchive(item)} />
                    <ActionButton icon={Icons.remove} label={t("inventory.items.actions.delete")} danger onClick={() => remove(item)} title={t("inventory.items.actions.deleteTitle")} />
                    <ActionButton icon={Icons.print} label={t("inventory.items.actions.print")} onClick={() => { setViewItem(item); setTimeout(() => window.print(), 0); }} />
                  </div></td>
                </tr>)}
                {filteredItems.length === 0 && <tr><td className="empty items-empty" colSpan={columnCount}><span>⌕</span><strong>{t("inventory.items.emptyTitle")}</strong><small>{t("inventory.items.emptySubtitle")}</small></td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <footer className="items-table-footer">{t("inventory.items.footer", { shown: filteredItems.length, total: items.length })}</footer>
      </section>

      {viewItem && <div className="voucher-overlay item-view-overlay" onMouseDown={() => setViewItem(null)}><div className="voucher-shell item-view-card" onMouseDown={(e) => e.stopPropagation()}>
        <button type="button" className="voucher-close-x" onClick={() => setViewItem(null)} aria-label={t("inventory.items.view.close")}>×</button>
        <div className="item-view-head"><span className="item-avatar large">{TYPE_ICON[viewItem.type] || "◇"}</span><div><small>{t("inventory.items.view.cardLabel", { type: TYPE_LABEL[viewItem.type] || t("inventory.items.unspecifiedType") })}</small><h3>{viewItem.name}</h3><span className="item-code">{viewItem.code}</span></div></div>
        <dl>
          <div><dt>{t("inventory.items.view.category")}</dt><dd>{viewItem.category || "—"}</dd></div>
          <div><dt>{t("inventory.items.view.unit")}</dt><dd>{viewItem.unit || "—"}</dd></div>
          <div><dt>{t("inventory.items.view.averageCost")}</dt><dd>{fmt2(viewItem.averageCost || 0)}</dd></div>
          <div><dt>{t("inventory.items.view.salePrice")}</dt><dd>{viewItem.salePrice != null ? fmt2(viewItem.salePrice) : "—"}</dd></div>
          <div><dt>{t("inventory.items.view.reorderLevel")}</dt><dd>{viewItem.reorderLevel || "—"}</dd></div>
          <div><dt>{t("inventory.items.view.quantity")}</dt><dd>{viewItem.quantity ?? "—"}</dd></div>
        </dl>
        <div className="voucher-actions"><button className="btn-ghost" onClick={() => setViewItem(null)}>{t("inventory.items.view.close")}</button><button className="btn-primary" onClick={() => window.print()}>{t("inventory.items.view.print")}</button></div>
      </div></div>}
    </div>
  );
}
