import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { listAccounts, getNextAccountCode, createAccount, updateAccount, deleteAccount, installStandardChart } from "../api/accounts";
import { fmt } from "../legacy/constants";
import { Icon } from "../legacy/shared";
import { useAuth } from "../context/AuthContext";
import AccountImportPanel from "./AccountImportPanel";
import AccountSearchSelect from "./shared/AccountSearchSelect";
import { useDeferredFilters } from "./shared/useDeferredFilters";

const LEVEL_CODE_LENGTH = { 1: 1, 2: 2, 3: 3, 4: 6 };
const emptyForm = { name: "", nameEn: "", code: "", type: "asset", parentId: "", isPosting: false, isBankOrCash: false, isEmployeeAdvanceAccount: false };
const emptyChartFilters = { search: "", level: 4, type: "", status: "active" };

export default function ChartOfAccountsModule({ companies = [], companyId }) {
  const { t } = useTranslation();
  const TYPE_LABEL = t("chartOfAccounts.typeLabel", { returnObjects: true });
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
  const [scope, setScope] = useState(companyId || "group");
  const [accounts, setAccounts] = useState([]);
  const [expanded, setExpanded] = useState(new Set());
  const [compact, setCompact] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const chartFilters = useDeferredFilters(emptyChartFilters);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => { if (companyId) setScope(companyId); }, [companyId]);
  const reload = () => listAccounts({ tree: true, companyId: scope === "group" ? undefined : scope })
    .then((rows) => { setAccounts(rows); setExpanded(new Set(rows.filter((a) => a.level < 4).map((a) => a.id))); setError(""); })
    .catch((err) => setError(err.message));
  useEffect(() => { reload(); }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedParent = accounts.find((a) => a.id === form.parentId);
  const level = selectedParent ? selectedParent.level + 1 : 1;
  const editingAccount = accounts.find((a) => a.id === editingId);
  const possibleParents = accounts.filter((a) => !a.isPosting && !a.isArchived && a.level < 4 && a.id !== editingId
    && (!editingAccount || a.level === editingAccount.level - 1));
  const children = useMemo(() => {
    const map = new Map();
    accounts.forEach((a) => map.set(a.parentId, [...(map.get(a.parentId) || []), a]));
    return map;
  }, [accounts]);

  // فلترة أساسية (بحث/مستوى/تصنيف/حالة) — بلا فلترة تلقائية فورية، فقط عند الضغط على "إظهار
  // النتائج" (chartFilters.applied بدل .draft). بلا بحث نصي: تبقى الشجرة الهرمية القابلة للطي/الفتح
  // كما هي (فقط بحدّ أقصى للعمق وتصنيف/حالة). مع بحث نصي: تتحوّل لقائمة نتائج مسطّحة (كل الحسابات
  // المطابقة عبر كل المستويات دفعة واحدة) بدل تعقيد حقن الآباء لإبقاء الشجرة سليمة.
  const cf = chartFilters.applied;
  const matchesFilters = (a) => {
    if (cf.type && a.type !== cf.type) return false;
    const isArchived = a.isArchived === true;
    if (cf.status === "active" && isArchived) return false;
    if (cf.status === "archived" && !isArchived) return false;
    return true;
  };
  const searchText = cf.search.trim().toLocaleLowerCase("ar");

  const rows = [];
  if (searchText) {
    accounts
      .filter((a) => a.level <= cf.level && matchesFilters(a))
      .filter((a) => a.name?.toLocaleLowerCase("ar").includes(searchText) || a.nameEn?.toLowerCase().includes(searchText) || a.code?.includes(searchText))
      .sort((a, b) => a.code.localeCompare(b.code))
      .forEach((a) => rows.push(a));
  } else {
    const walk = (parentId = null) => (children.get(parentId) || []).forEach((account) => {
      if (account.level > cf.level || !matchesFilters(account)) return; // لا يُعرض ولا تُستكمَل فروعه
      rows.push(account);
      if (!compact && account.level < cf.level && expanded.has(account.id)) walk(account.id);
    });
    walk();
  }

  const closeAccountModal = () => { setForm(emptyForm); setEditingId(null); setAddModalOpen(false); setError(""); };
  const reset = closeAccountModal;
  const openAddModal = () => { setEditingId(null); setError(""); setSuccess(""); setForm(emptyForm); setAddModalOpen(true); };
  const save = async () => {
    setError("");
    setSuccess("");
    if (form.name.trim().length < 2) return setError(t("chartOfAccounts.errNameRequired"));
    if (!form.code.trim()) return setError(t("chartOfAccounts.errCodeRequired"));
    if (level > 1 && !form.parentId) return setError(t("chartOfAccounts.errParentRequired"));
    const expectedLength = LEVEL_CODE_LENGTH[level];
    if (!expectedLength || !new RegExp(`^\\d{${expectedLength}}$`).test(form.code)) {
      return setError(t("chartOfAccounts.errCodeLength", { level, length: expectedLength ?? "؟" }));
    }
    // عند نقل حساب موجود (تعديل بأب مختلف)، النوع يجب أن يبقى كما هو — النقل مسموح فقط بين مجموعات
    // من نفس النوع. هذا فحص فوري للواجهة (تجربة أفضل)، والخادم يتحقق منه مرة أخرى كمرجع نهائي.
    if (editingId && selectedParent && selectedParent.type !== form.type) {
      return setError(t("chartOfAccounts.errTypeMismatch", { fromType: TYPE_LABEL[form.type], toType: TYPE_LABEL[selectedParent.type] }));
    }
    const payload = {
      ...form,
      name: form.name.trim(), nameEn: form.nameEn.trim() || null, code: form.code.trim(), parentId: form.parentId || null,
      companyId: scope === "group" ? null : scope, level,
    };
    try {
      setSaving(true);
      if (editingId) {
        try {
          await updateAccount(editingId, payload);
        } catch (err) {
          if (!err.details?.requiresMoveConfirmation || !window.confirm(t("chartOfAccounts.confirmMoveWithTransactions", { message: err.message }))) throw err;
          await updateAccount(editingId, { ...payload, confirmMoveWithTransactions: true });
        }
      } else await createAccount(payload);
      const message = editingId ? t("chartOfAccounts.savedEdit") : t("chartOfAccounts.savedCreate");
      reset();
      await reload();
      setSuccess(message);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };
  const edit = (a) => { setAddModalOpen(false); setEditingId(a.id); setForm({ name: a.name, nameEn: a.nameEn || "", code: a.code, type: a.type, parentId: a.parentId || "", isPosting: a.isPosting, isBankOrCash: a.isBankOrCash, isEmployeeAdvanceAccount: a.isEmployeeAdvanceAccount }); };
  const addChild = async (a) => {
    setEditingId(null); setError(""); setSuccess("");
    try {
      const { code } = await getNextAccountCode(a.id, scope === "group" ? undefined : scope);
      setForm({ ...emptyForm, type: a.type, parentId: a.id, code, isPosting: a.level === 3 });
      setAddModalOpen(true);
    } catch (err) { setError(err.message); }
  };
  const selectParent = async (parentId) => {
    // أثناء التعديل/النقل، اختيار أب جديد لا يجب أن يمسّ الكود أو المستوى أو isPosting أو النوع —
    // هذه خصائص ثابتة للحساب الحالي نفسه، والنقل يغيّر parentId فقط (يُتحقَّق من توافق النوع مع
    // الأب الجديد لاحقاً في save() ومرة أخرى في الخادم، لا هنا).
    if (editingId) return setForm((current) => ({ ...current, parentId }));
    if (!parentId) return setForm((current) => ({ ...current, parentId: "", code: "", isPosting: false }));
    const parent = accounts.find((account) => account.id === parentId);
    setError("");
    try {
      const { code } = await getNextAccountCode(parentId, scope === "group" ? undefined : scope);
      setForm((current) => ({ ...current, parentId, code, type: parent?.type || current.type, isPosting: parent?.level === 3 }));
    } catch (err) { setError(err.message); }
  };
  const archive = async (a) => {
    setError(""); setSuccess("");
    try { await updateAccount(a.id, { isArchived: !a.isArchived }); await reload(); setSuccess(a.isArchived ? t("chartOfAccounts.unarchived") : t("chartOfAccounts.archived")); }
    catch (err) { setError(err.message); }
  };
  const remove = async (a) => {
    if (!window.confirm(t("chartOfAccounts.confirmDelete", { name: a.name }))) return;
    try { await deleteAccount(a.id); await reload(); setSuccess(t("chartOfAccounts.deleted")); } catch (err) { setError(err.message); }
  };
  const toggle = (id) => setExpanded((old) => { const next = new Set(old); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const installStandard = async () => {
    const scopeName = scope === "group" ? t("chartOfAccounts.installScopeGroup") : t("chartOfAccounts.installScopeCompany");
    if (!window.confirm(t("chartOfAccounts.confirmInstall", { scope: scopeName }))) return;
    const confirmation = window.prompt(t("chartOfAccounts.installPrompt"));
    if (confirmation !== "تثبيت") return;
    setInstalling(true);
    setError("");
    try {
      const result = await installStandardChart({
        companyId: scope === "group" ? null : scope,
        confirmation: "INSTALL_STANDARD_CHART",
      });
      reset();
      await reload();
      window.alert(t("chartOfAccounts.installSuccess", { installed: result.installedAccounts, deleted: result.deletedAccounts }));
    } catch (err) {
      setError(err.message);
    } finally {
      setInstalling(false);
    }
  };

  // حقول الفورم مشتركة بالكامل بين وضع "إضافة حساب" ووضع "تعديل/نقل" — كلاهما الآن نافذة منبثقة
  // (accountModalOpen)، فقط العنوان وسلوك الحفظ يختلفان حسب editingId.
  const accountModalOpen = editingId || addModalOpen;
  const formFields = (
    <div className="form-grid">
      <label>{t("chartOfAccounts.form.nameAr")}<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
      <label>{t("chartOfAccounts.form.nameEn")}<input dir="ltr" value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} /></label>
      <label>{t("chartOfAccounts.form.code")}<input inputMode="numeric" maxLength={LEVEL_CODE_LENGTH[level] || 6} readOnly={Boolean(editingId)} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.replace(/\D/g, "") })} placeholder={level === 4 ? t("chartOfAccounts.form.codeAutoPlaceholder") : t("chartOfAccounts.form.codeLevelPlaceholder", { level })} /></label>
      <label>{t("chartOfAccounts.form.parent")}
        <AccountSearchSelect accounts={possibleParents} value={form.parentId} onChange={selectParent} allowClear clearLabel={t("chartOfAccounts.form.parentClearLabel")} />
      </label>
      {!selectedParent && <label>{t("chartOfAccounts.form.type")}<select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>}
      {level === 4 && <label className="checkbox-label"><input type="checkbox" checked readOnly />{t("chartOfAccounts.form.postingAccount")}</label>}
      {form.isPosting && form.type === "asset" && <label className="checkbox-label"><input type="checkbox" checked={form.isBankOrCash} onChange={(e) => setForm({ ...form, isBankOrCash: e.target.checked })} />{t("chartOfAccounts.form.bankOrCash")}</label>}
      {form.isPosting && form.type === "asset" && (
        <label className="checkbox-label">
          <input type="checkbox" checked={form.isEmployeeAdvanceAccount} onChange={(e) => setForm({ ...form, isEmployeeAdvanceAccount: e.target.checked })} />
          {t("chartOfAccounts.form.employeeAdvanceAccount")}
        </label>
      )}
    </div>
  );

  return (
    <div>
      {error && !accountModalOpen && <p className="balance-bad">{error}</p>}
      {success && <p className="balance-good">{success}</p>}
      <div className="panel form-panel">
        <div className="form-btn-group" style={{ justifyContent: "space-between" }}>
          <label>{t("chartOfAccounts.scopeLabel")}
            <select value={scope} onChange={(e) => { setScope(e.target.value); reset(); }}>
              <option value="group">{t("chartOfAccounts.scopeGroupOption")}</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.shortName || c.name}</option>)}
            </select>
          </label>
          <div className="form-btn-group">
            <button className="btn-primary" onClick={openAddModal}>{t("chartOfAccounts.addAccount")}</button>
            <button className="btn-ghost" onClick={() => setCompact((v) => !v)}>{compact ? t("chartOfAccounts.expandView") : t("chartOfAccounts.compactView")}</button>
            {isSuperAdmin && (
              <button className="btn-ghost" style={{ color: "#A8432B", borderColor: "rgba(168,67,43,0.35)" }} disabled={installing} onClick={installStandard}>
                {installing ? t("chartOfAccounts.installing") : t("chartOfAccounts.installStandard")}
              </button>
            )}
          </div>
        </div>

        <form className="filter-bar" onSubmit={(e) => { e.preventDefault(); chartFilters.apply(); }}>
          <label>{t("chartOfAccounts.filters.searchLabel")}
            <input type="text" value={chartFilters.draft.search} onChange={(e) => chartFilters.setField("search", e.target.value)} placeholder={t("chartOfAccounts.filters.searchPlaceholder")} />
          </label>
          <label>
            {t("chartOfAccounts.filters.levelLabel")}
            <select value={chartFilters.draft.level} onChange={(e) => chartFilters.setField("level", Number(e.target.value))}>
              <option value={1}>{t("chartOfAccounts.filters.level1")}</option>
              <option value={2}>{t("chartOfAccounts.filters.level2")}</option>
              <option value={3}>{t("chartOfAccounts.filters.level3")}</option>
              <option value={4}>{t("chartOfAccounts.filters.level4Full")}</option>
            </select>
          </label>
          <label>{t("chartOfAccounts.filters.type")}
            <select value={chartFilters.draft.type} onChange={(e) => chartFilters.setField("type", e.target.value)}>
              <option value="">{t("chartOfAccounts.filters.allTypes")}</option>
              {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label>{t("chartOfAccounts.filters.status")}
            <select value={chartFilters.draft.status} onChange={(e) => chartFilters.setField("status", e.target.value)}>
              <option value="active">{t("chartOfAccounts.filters.statusActive")}</option>
              <option value="archived">{t("chartOfAccounts.filters.statusArchived")}</option>
            </select>
          </label>
          <button type="submit" className="btn-primary" style={{ alignSelf: "end" }}>{t("chartOfAccounts.filters.showResults")}</button>
        </form>
      </div>

      <AccountImportPanel scope={scope} accounts={accounts} onImported={reload} />

      {accountModalOpen && (
        <div className="invoice-modal-overlay" onClick={() => !saving && closeAccountModal()}>
          <div className="invoice-modal-box" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-title-row">
              <h3>{editingId ? t("chartOfAccounts.modal.editTitle", { name: editingAccount?.name || "" }) : (form.parentId ? t("chartOfAccounts.modal.addChildTitle") : t("chartOfAccounts.modal.addNewTitle"))}</h3>
              <button type="button" className="modal-close-btn" onClick={closeAccountModal} disabled={saving} aria-label={t("common.close")}>×</button>
            </div>
            {formFields}
            {error && <p className="balance-bad">{error}</p>}
            <div className="form-btn-group">
              <button type="button" className="btn-ghost" onClick={closeAccountModal} disabled={saving}>{t("common.cancel")}</button>
              <button type="button" className="btn-primary" disabled={saving} onClick={save}>{saving ? t("chartOfAccounts.modal.saving") : (editingId ? t("chartOfAccounts.modal.saveEdit") : t("chartOfAccounts.modal.saveCreate"))}</button>
              <span className="note">{editingId ? t("chartOfAccounts.modal.noteEditing") : t(level === 4 ? "chartOfAccounts.modal.noteLevelPosting" : "chartOfAccounts.modal.noteLevelGroup", { level })}</span>
            </div>
          </div>
        </div>
      )}

      <div className="panel">
        <table className="ledger-table">
          <thead><tr><th>{t("chartOfAccounts.table.code")}</th><th>{t("chartOfAccounts.table.account")}</th><th>{t("chartOfAccounts.table.level")}</th><th>{t("chartOfAccounts.table.type")}</th><th>{t("chartOfAccounts.table.balance")}</th><th>{t("chartOfAccounts.table.actions")}</th></tr></thead>
          <tbody>{rows.map((a) => {
            const hasChildren = (children.get(a.id) || []).length > 0;
            return <tr key={a.id} style={{ opacity: a.isArchived ? .55 : 1 }}>
              <td className="num">{a.code}</td>
              <td style={{ paddingRight: `${12 + (a.level - 1) * 24}px` }}><button className="icon-btn" disabled={!hasChildren} onClick={() => toggle(a.id)}>{hasChildren ? (expanded.has(a.id) ? "−" : "+") : "•"}</button> {a.name}{a.nameEn && <small style={{ display: "block", direction: "ltr", color: "#6b7280" }}>{a.nameEn}</small>}</td>
              <td>{a.level}</td><td>{a.isPosting ? t("chartOfAccounts.table.postingAccount") : t("chartOfAccounts.table.groupAccount")}</td><td className="num">{fmt(a.balance || 0)}</td>
              <td className="row-actions">
                {!a.isPosting && a.level < 4 && <button type="button" className="icon-btn" title={t("chartOfAccounts.table.addChildTitle")} onClick={() => addChild(a)}>＋</button>}
                <button className="icon-btn" title={t("chartOfAccounts.table.editTitle")} onClick={() => edit(a)}><Icon.Edit /></button>
                <button className="icon-btn" title={a.isArchived ? t("chartOfAccounts.table.unarchiveTitle") : t("chartOfAccounts.table.archiveTitle")} onClick={() => archive(a)}>▣</button>
                <button className="icon-btn icon-btn-danger" title={t("chartOfAccounts.table.deleteTitle")} onClick={() => remove(a)}><Icon.Trash /></button>
              </td>
            </tr>;
          })}{rows.length === 0 && <tr><td colSpan={6} className="empty">{t("chartOfAccounts.table.empty")}</td></tr>}</tbody>
        </table>
      </div>
    </div>
  );
}
