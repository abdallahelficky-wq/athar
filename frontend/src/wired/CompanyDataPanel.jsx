import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { NavIcon } from "../legacy/navIcons";
import { useUnsavedChangesGuard } from "./shared/UnsavedChangesContext";
import { updateCompany, uploadCompanyLogo, extractCompanyDocument, reopenFiscalClosing } from "../api/companies";
import { listAccounts } from "../api/accounts";
import { listItems } from "../api/items";
import AttachmentsPanel from "./shared/AttachmentsPanel";
import CompanyDocumentsPanel from "./CompanyDocumentsPanel";
import LeaseContractsPanel from "./LeaseContractsPanel";
import BranchesPanel from "./BranchesPanel";
import CompanyBankAccountsPanel from "./CompanyBankAccountsPanel";
import FiscalYearPanel from "./FiscalYearPanel";
import AccountSearchSelect from "./shared/AccountSearchSelect";
import { StoreShippingZonesPanel, StoreCouponsPanel } from "./StoreSettingsPanels";
import { storeFeedUrl } from "../api/storeAdmin";
import { COUNTRIES, CURRENCIES, countryName, defaultCurrencyForCountry, defaultVatRateForCountry, isValidVatNumberForCountry, vatNumberExampleForCountry } from "../shared/countries";

// روابط حسابات المتجر في منصات التواصل — تظهر في تذييل المتجر (https فقط)
const SOCIAL_KEYS = ["instagram", "x", "tiktok", "snapchat", "website"];
const EMPTY_SOCIAL = Object.fromEntries(SOCIAL_KEYS.map((k) => [k, ""]));

const emptyForm = (c) => ({
  name: c.name || "",
  shortName: c.shortName || "",
  nameEn: c.nameEn || "",
  licenseNumber: c.licenseNumber || "",
  unifiedEntityNumber: c.unifiedEntityNumber || "",
  country: c.country || "SA",
  currency: c.currency || "SAR",
  vatRate: c.vatRate == null ? defaultVatRateForCountry(c.country || "SA") : Number(c.vatRate),
  vatNumber: c.vatNumber || "",
  numberingPrefix: c.numberingPrefix || "",
  crNumber: c.crNumber || "",
  crIssueDate: c.crIssueDate ? c.crIssueDate.slice(0, 10) : "",
  crExpiryDate: c.crExpiryDate ? c.crExpiryDate.slice(0, 10) : "",
  officialEmail: c.officialEmail || "",
  phone: c.phone || "",
  addressBuilding: c.addressBuilding || "",
  addressStreet: c.addressStreet || "",
  addressDistrict: c.addressDistrict || "",
  addressCity: c.addressCity || "",
  addressPostalCode: c.addressPostalCode || "",
  addressAdditionalNo: c.addressAdditionalNo || "",
  vatFilingFrequency: c.vatFilingFrequency || "quarterly",
  zakatDeclarationDueDate: c.zakatDeclarationDueDate ? c.zakatDeclarationDueDate.slice(0, 10) : "",
  lowCashThreshold: c.lowCashThreshold ?? "",
  overdueInvoiceDays: c.overdueInvoiceDays ?? 30,
  staleDraftDays: c.staleDraftDays ?? 7,
  fiscalYearClosingDate: c.fiscalYearClosingDate ? c.fiscalYearClosingDate.slice(0, 10) : "",
  stationCashShortageAccountId: c.stationCashShortageAccountId || "",
  stationCashSurplusAccountId: c.stationCashSurplusAccountId || "",
  tankVarianceAccountId: c.tankVarianceAccountId || "",
  cardFeeExpenseAccountId: c.cardFeeExpenseAccountId || "",
  stationDieselItemId: c.stationDieselItemId || "",
  stationGasoline91ItemId: c.stationGasoline91ItemId || "",
  stationGasoline95ItemId: c.stationGasoline95ItemId || "",
  allowNegativeFuelStock: c.allowNegativeFuelStock ?? true,
  storeEnabled: c.storeEnabled ?? false,
  storeListed: c.storeListed ?? false,
  storeSlug: c.storeSlug || "",
  storeName: c.storeName || "",
  storeNameEn: c.storeNameEn || "",
  storeWhatsappNumber: c.storeWhatsappNumber || "",
  storeAccentColor: c.storeAccentColor || "",
  storeAbout: c.storeAbout || "",
  storeAboutEn: c.storeAboutEn || "",
  storeSocial: { ...EMPTY_SOCIAL, ...(c.storeSocial && typeof c.storeSocial === "object" ? c.storeSocial : {}) },
  storeMetaPixelId: c.storeMetaPixelId || "",
  storeFreeShippingOver: c.storeFreeShippingOver == null ? "" : Number(c.storeFreeShippingOver),
  storePickupEnabled: c.storePickupEnabled ?? false,
  storePickupAddress: c.storePickupAddress || "",
  storeCodEnabled: c.storeCodEnabled ?? true,
  storeBankTransferEnabled: c.storeBankTransferEnabled ?? false,
  storeBankTransferDetails: c.storeBankTransferDetails || "",
  storeMinOrderAmount: c.storeMinOrderAmount == null ? "" : Number(c.storeMinOrderAmount),
  storeReturnPolicy: c.storeReturnPolicy || "",
  storePrivacyPolicy: c.storePrivacyPolicy || "",
});

// صنف المخزون لكل منتج وقود — يُصرَف منه بالمتوسط المرجّح عند ترحيل وردية المحطة (راجع stationShiftCogs.ts)
const STATION_FUEL_ITEM_FIELDS = [
  ["stationDieselItemId", "stationDieselItemLabel"],
  ["stationGasoline91ItemId", "stationGasoline91ItemLabel"],
  ["stationGasoline95ItemId", "stationGasoline95ItemLabel"],
];

// حقول كل قسم يُحفَظ بزر خاص — PATCH /companies/:id يقبل حمولة جزئية (updateCompanySchema = partial)
// ويفحص كل قيد عند وجود حقله فقط ("vatNumber" in body، "fiscalYearClosingDate" in body…)، فحفظ قسم لا يمسّ غيره.
const SECTION_FIELDS = {
  basic: ["name", "shortName", "nameEn", "country", "currency", "officialEmail", "phone"],
  registration: ["crNumber", "crIssueDate", "crExpiryDate", "unifiedEntityNumber", "licenseNumber"],
  tax: ["vatNumber", "vatRate", "vatFilingFrequency", "zakatDeclarationDueDate"],
  address: ["addressBuilding", "addressStreet", "addressDistrict", "addressCity", "addressPostalCode", "addressAdditionalNo"],
  numbering: ["numberingPrefix"],
  alerts: ["lowCashThreshold", "overdueInvoiceDays", "staleDraftDays"],
  stations: ["stationCashShortageAccountId", "stationCashSurplusAccountId", "tankVarianceAccountId", "cardFeeExpenseAccountId", "stationDieselItemId", "stationGasoline91ItemId", "stationGasoline95ItemId", "allowNegativeFuelStock"],
  fiscal: ["fiscalYearClosingDate"],
  // المتجر الإلكتروني العام (واجهة البيع /store/<الرابط>) — راجع src/modules/store في الخادم. كل قسم يُحفَظ وحده
  // (assertStoreSettings في الخادم يفحص storeSlug/storeEnabled معاً، وهما في القسم نفسه).
  storeGeneral: ["storeEnabled", "storeListed", "storeSlug", "storeName", "storeNameEn", "storeWhatsappNumber"],
  storeAppearance: ["storeAccentColor", "storeAbout", "storeAboutEn", "storeSocial"],
  storeShipping: ["storeFreeShippingOver", "storeMinOrderAmount", "storePickupEnabled", "storePickupAddress"],
  storePayment: ["storeCodEnabled", "storeBankTransferEnabled", "storeBankTransferDetails"],
  storeMarketing: ["storeMetaPixelId"],
  storePolicies: ["storeReturnPolicy", "storePrivacyPolicy"],
};
const FIELD_SECTION = Object.fromEntries(Object.entries(SECTION_FIELDS).flatMap(([sec, keys]) => keys.map((k) => [k, sec])));

// نفس تحويلات الحفظ الكامل السابق حقلاً حقلاً (undefined يُسقَط من JSON فلا يُرسَل)
const toPayloadValue = (key, v) => {
  switch (key) {
    case "crIssueDate": case "crExpiryDate": case "zakatDeclarationDueDate": return v || undefined;
    case "lowCashThreshold": return v === "" ? null : Number(v);
    case "overdueInvoiceDays": case "staleDraftDays": return Number(v);
    case "vatRate": return v === "" ? undefined : Number(v);
    case "fiscalYearClosingDate": return v || null;
    case "allowNegativeFuelStock": case "storeEnabled": case "storeListed":
    case "storePickupEnabled": case "storeCodEnabled": case "storeBankTransferEnabled": return Boolean(v);
    case "storeFreeShippingOver": case "storeMinOrderAmount": return v === "" || Number(v) <= 0 ? null : Number(v);
    case "storeSocial": {
      const links = Object.fromEntries(Object.entries(v || {}).map(([k, x]) => [k, String(x || "").trim()]).filter(([, x]) => x));
      return Object.keys(links).length ? links : null;
    }
    case "storeSlug": return String(v || "").trim().toLowerCase() || null;
    case "stationCashShortageAccountId": case "stationCashSurplusAccountId": case "tankVarianceAccountId": case "cardFeeExpenseAccountId":
    case "stationDieselItemId": case "stationGasoline91ItemId": case "stationGasoline95ItemId": return v || null;
    default: return v;
  }
};
// كل الأقسام المبنية هنا — كل شاشة تعرض منها ما يخصّها عبر only (الإعدادات، الحسابات، المتجر، المحطات)
const BUILTIN_SECTIONS = [
  { key: "basic", icon: "companies", group: "company" },
  { key: "registration", icon: "companyDocs", group: "company" },
  { key: "tax", icon: "vat", group: "company" },
  { key: "address", icon: "locations", group: "company" },
  { key: "logo", icon: "sImage", group: "company" },
  { key: "documents", icon: "sClip", group: "company" },
  { key: "branches", icon: "categories", group: "operations" },
  { key: "leases", icon: "contracts", group: "operations" },
  { key: "alerts", icon: "sBell", group: "operations" },
  { key: "fiscal", icon: "leaves", group: "accounting" },
  { key: "numbering", icon: "sHash", group: "accounting" },
  { key: "bankAccounts", icon: "sBank", group: "accounting" },
  { key: "storeGeneral", icon: "onlineStore", group: "store" },
  { key: "storeAppearance", icon: "storeAppearance", group: "store" },
  { key: "storeShipping", icon: "storeShipping", group: "store" },
  { key: "storePayment", icon: "storePayment", group: "store" },
  { key: "storeMarketing", icon: "storeMarketing", group: "store" },
  { key: "storePolicies", icon: "storePolicies", group: "store" },
  { key: "stations", icon: "stations", group: "stations" },
];
export const SETTINGS_PAGE_SECTIONS = ["basic", "registration", "tax", "address", "logo", "documents", "branches", "leases", "alerts"];
const GROUP_ORDER = ["company", "operations", "accounting", "store", "stations", "account", "elsewhere"];

const asText = (v) => (v && typeof v === "object" ? JSON.stringify(v) : String(v ?? ""));
const sameValue = (a, b) => asText(a) === asText(b);

/** نافذة تعديل بيانات الشركة الرسمية الكاملة — شعار، عنوان وطني، تواريخ السجل التجاري،
 * بيانات التواصل، بالإضافة إلى استخراج تلقائي بالذكاء الاصطناعي من المستندات الرسمية. */
/** بيانات الشركة مقسّمة أقساماً بقائمة جانبية، تُعرَض مباشرة داخل صفحة «بيانات الشركات» (لا نافذة منبثقة).
 * extraSections: أقسام إضافية من الصفحة نفسها ({ key, icon, label, group: "company"|"account", render }) تظهر في
 * القائمة نفسها. header: محتوى أعلى القائمة (مُحدِّد الشركة). onDirtyChange: يُبلَّغ بوجود تعديلات غير محفوظة. */
/* only: مفاتيح الأقسام المبنية المعروضة في هذه الشاشة. links: بطاقات تنقل لصفحات أخرى ({ key, icon, label, desc, to, group }).
 * أكثر من قسم = صفحة بطاقات يُفتَح منها القسم؛ قسم واحد = يُعرَض مباشرة بلا بطاقات. */
export default function CompanyDataPanel({ company, onChanged, extraSections = [], links = [], only = SETTINGS_PAGE_SECTIONS, header = null, initialSection, onDirtyChange }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const canReopen = user?.role === "admin" || user?.role === "super_admin";
  const DOC_TYPES = [
    { key: "cr", label: t("settings.companyEdit.docTypeCr") },
    { key: "national_address", label: t("settings.companyEdit.docTypeNationalAddress") },
    { key: "vat_certificate", label: t("settings.companyEdit.docTypeVatCert") },
  ];

  const [form, setForm] = useState(() => emptyForm(company));
  // آخر قيم محفوظة على الخادم — للمقارنة وإظهار الأقسام التي فيها تعديلات لم تُحفَظ
  const [baseline, setBaseline] = useState(() => emptyForm(company));
  const [sectionSaving, setSectionSaving] = useState(null);
  const [sectionStatus, setSectionStatus] = useState({}); // { [section]: { ok, text } }
  const [extractedKeys, setExtractedKeys] = useState([]);
  const [logoUrl, setLogoUrl] = useState(company.logoUrl || null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [extracting, setExtracting] = useState(null); // docType الجاري استخراجه
  const [extractionNote, setExtractionNote] = useState(null); // { confidence, text }
  const [error, setError] = useState("");
  const [attachmentsKey, setAttachmentsKey] = useState(0);
  const [reopenDate, setReopenDate] = useState("");
  const [reopening, setReopening] = useState(false);
  const [reopenNotice, setReopenNotice] = useState("");
  const [reopenError, setReopenError] = useState("");
  const [accounts, setAccounts] = useState([]);
  const [inventoryItems, setInventoryItems] = useState([]);

  const logoInputRef = useRef(null);
  const docInputRefs = useRef({});

  useEffect(() => { listAccounts({ companyId: company.id }).then(setAccounts).catch(() => {}); }, [company.id]);
  const isFuelCompany = company.businessActivity === "fuel_stations";
  useEffect(() => {
    if (!isFuelCompany) return;
    listItems(company.id, { type: "inventory" })
      .then((rows) => setInventoryItems(rows.filter((i) => !i.isArchived)))
      .catch(() => {});
  }, [company.id, isFuelCompany]);
  const postingAccounts = useMemo(() => accounts.filter((a) => a.isPosting && a.isActive && !a.isArchived), [accounts]);
  const stationExpenseAccounts = useMemo(() => postingAccounts.filter((a) => a.type === "expense"), [postingAccounts]);
  const stationRevenueAccounts = useMemo(() => postingAccounts.filter((a) => a.type === "revenue"), [postingAccounts]);

  // الأقسام تبقى مُركَّبة (مخفية فقط) حتى لا تضيع تعديلات قسم لم يُحفَظ عند التنقل بين البطاقات
  const sections = BUILTIN_SECTIONS
    .filter((x) => only.includes(x.key) && (x.key !== "stations" || isFuelCompany))
    .map((x) => ({ ...x, label: t(`settings.companyEdit.tabs.${x.key}`), desc: t(`settings.companyEdit.cards.${x.key}`) }));
  const has = (key) => sections.some((x) => x.key === key);
  const openable = [...sections, ...extraSections.map((x) => ({ group: "account", ...x }))];
  const cards = [...openable, ...links.map((x) => ({ group: "elsewhere", ...x }))];
  const single = cards.length === 1;
  const allKeys = openable.map((x) => x.key);
  const [activeSection, setActiveSection] = useState(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("section");
    return [initialSection, fromUrl].find((k) => k && allKeys.includes(k)) || (single ? allKeys[0] : null);
  });
  // القسم المفتوح يُحفَظ في الرابط (?section=) ليبقى بعد إعادة التحميل ويمكن مشاركته
  useEffect(() => {
    if (single) return;
    try {
      const url = new URL(window.location.href);
      if ((url.searchParams.get("section") || null) === activeSection) return;
      if (activeSection) url.searchParams.set("section", activeSection); else url.searchParams.delete("section");
      window.history.replaceState(window.history.state, "", url);
    } catch { /* بيئة بلا history — القسم يعمل بدون الرابط */ }
  }, [activeSection, single]);
  useEffect(() => { window.scrollTo?.({ top: 0 }); }, [activeSection]);

  // أي تعديل في حقل يُسقط رسالة آخر حفظ لقسمه — لا تبقى رسالة رفض قديمة ظاهرة فوق قيمة جديدة لم تُرسَل بعد
  const set = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    const sec = FIELD_SECTION[field];
    if (sec) setSectionStatus((p) => (p[sec] ? { ...p, [sec]: null } : p));
  };

  const isDirty = (keys) => keys.some((k) => !sameValue(form[k], baseline[k]));
  const dirtySections = new Set(Object.keys(SECTION_FIELDS).filter((sec) => isDirty(SECTION_FIELDS[sec])));
  const saving = sectionSaving !== null;

  // حفظ مجموعة حقول فقط (قسم واحد، أو حقول المستند المستخرج) — لا تُغلَق النافذة بعد الحفظ
  const saveFields = async (statusKey, keys) => {
    if (keys.includes("name") && !form.name.trim()) {
      setSectionStatus((p) => ({ ...p, [statusKey]: { ok: false, text: t("settings.companyEdit.errNameRequired") } }));
      return;
    }
    setSectionSaving(statusKey);
    setSectionStatus((p) => ({ ...p, [statusKey]: null }));
    try {
      const payload = Object.fromEntries(keys.map((k) => [k, toPayloadValue(k, form[k])]));
      const updated = await updateCompany(company.id, payload);
      const fresh = emptyForm(updated);
      const pick = (src) => Object.fromEntries(keys.map((k) => [k, src[k]]));
      setBaseline((prev) => ({ ...prev, ...pick(fresh) }));
      setForm((prev) => ({ ...prev, ...pick(fresh) }));
      setSectionStatus((p) => ({ ...p, [statusKey]: { ok: true, text: t("settings.companyEdit.tabs.sectionSaved") } }));
      onChanged?.();
      return true;
    } catch (err) {
      setSectionStatus((p) => ({ ...p, [statusKey]: { ok: false, text: err.message } }));
      return false;
    } finally {
      setSectionSaving(null);
    }
  };

  const saveExtracted = async () => {
    const ok = await saveFields("documents", extractedKeys);
    if (ok) setExtractedKeys([]);
  };

  const hasDirty = dirtySections.size > 0;
  useEffect(() => { onDirtyChange?.(hasDirty); }, [hasDirty, onDirtyChange]);
  useUnsavedChangesGuard(hasDirty);
  // تحذير المتصفح عند مغادرة الصفحة وفيها تعديلات لم تُحفَظ
  useEffect(() => {
    if (!hasDirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasDirty]);

  // زر حفظ القسم وحالته
  const SectionSave = ({ section, keys = SECTION_FIELDS[section] }) => {
    const status = sectionStatus[section];
    const dirty = isDirty(keys);
    return (
      <div className="company-settings-section-save">
        {status && <span className={status.ok ? "note" : "balance-bad"}>{status.text}</span>}
        {!status && dirty && <span className="note">{t("settings.companyEdit.tabs.unsavedHint")}</span>}
        <button type="button" className="btn-primary" onClick={() => saveFields(section, keys)} disabled={saving}>
          {sectionSaving === section ? t("settings.myAccount.saving") : t("settings.companyEdit.tabs.saveSection")}
        </button>
      </div>
    );
  };

  const reopen = async () => {
    if (!window.confirm(t("settings.companyEdit.reopenConfirm"))) return;
    setReopening(true);
    setReopenError("");
    setReopenNotice("");
    setSectionStatus((p) => ({ ...p, fiscal: null }));
    try {
      const updated = await reopenFiscalClosing(company.id, reopenDate || null);
      const closing = updated.fiscalYearClosingDate ? updated.fiscalYearClosingDate.slice(0, 10) : "";
      setForm((prev) => ({ ...prev, fiscalYearClosingDate: closing }));
      setBaseline((prev) => ({ ...prev, fiscalYearClosingDate: closing }));
      onChanged?.();
      setReopenDate("");
      setReopenNotice(t("settings.companyEdit.reopenSuccess"));
    } catch (err) {
      setReopenError(err.message);
    } finally {
      setReopening(false);
    }
  };

  const pickLogo = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingLogo(true);
    setError("");
    try {
      const updated = await uploadCompanyLogo(company.id, file);
      setLogoUrl(updated.logoUrl);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploadingLogo(false);
    }
  };

  const pickDocument = async (docType, e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setExtracting(docType);
    setExtractionNote(null);
    setError("");
    try {
      const result = await extractCompanyDocument(company.id, docType, file);
      setAttachmentsKey((k) => k + 1);
      if (result.confidence === "low" || Object.keys(result.fields).length === 0) {
        setExtractionNote({
          confidence: "low",
          text: t("settings.companyEdit.extractionLowConfidence", { note: result.confidenceNote || t("settings.companyEdit.extractionLowConfidenceDefault") }),
        });
      } else {
        setForm((prev) => ({ ...prev, ...result.fields }));
        setExtractedKeys((prev) => [...new Set([...prev, ...Object.keys(result.fields).filter((k) => FIELD_SECTION[k])])]);
        setExtractionNote({
          confidence: "high",
          text: t("settings.companyEdit.extractionHighConfidence", { note: result.confidenceNote || "" }),
        });
      }
    } catch (err) {
      setExtractionNote({ confidence: "low", text: t("settings.companyEdit.extractionFailed", { message: err.message }) });
    } finally {
      setExtracting(null);
    }
  };

  const rtl = i18n.dir() === "rtl";
  const card = (x) => {
    const body = (
      <>
        <span className="settings-card-icon" aria-hidden="true"><NavIcon name={x.icon} /></span>
        <span className="settings-card-text">
          <span className="settings-card-title">{x.label}</span>
          {x.desc && <span className="settings-card-desc">{x.desc}</span>}
        </span>
        {dirtySections.has(x.key) && <i className="company-settings-dirty-dot" title={t("settings.companyEdit.tabs.unsavedHint")} />}
        <span className="settings-card-arrow" aria-hidden="true">{x.to ? "↗" : rtl ? "‹" : "›"}</span>
      </>
    );
    return x.to
      ? <Link key={x.key} to={x.to} className="settings-card settings-card-link">{body}</Link>
      : <button key={x.key} type="button" className="settings-card" onClick={() => setActiveSection(x.key)}>{body}</button>;
  };
  const groups = GROUP_ORDER.map((g) => ({ id: g, items: cards.filter((x) => x.group === g) })).filter((g) => g.items.length);
  const active = openable.find((x) => x.key === activeSection);

  return (
    <div className="settings-hub">
        {header && <div className="settings-hub-header">{header}</div>}
        {!active && (
          <div className="settings-hub-home">
            {groups.map((g) => (
              <div key={g.id} className="settings-hub-group">
                {groups.length > 1 && <h3 className="settings-hub-group-title">{t(`settings.companyEdit.groups.${g.id}`)}</h3>}
                <div className="settings-hub-grid">{g.items.map(card)}</div>
              </div>
            ))}
          </div>
        )}
        {active && !single && (
          <div className="settings-hub-bar">
            <button type="button" className="settings-hub-back" onClick={() => setActiveSection(null)}>
              <span aria-hidden="true">{rtl ? "→" : "←"}</span>{t("settings.companyEdit.hub.back")}
            </button>
            <span className="settings-card-icon" aria-hidden="true"><NavIcon name={active.icon} /></span>
            <div className="settings-hub-bar-text">
              <h3>{active.label}</h3>
              {active.desc && <p>{active.desc}</p>}
            </div>
          </div>
        )}
        <div className="panel form-panel settings-hub-body" hidden={!active}>
          <div className="company-settings-content">
            {has("basic") && <section hidden={activeSection !== "basic"} className="company-settings-section">
              <h4 className="sub-head company-settings-section-title">{t("settings.companyEdit.tabs.basic")}</h4>
              <div className="form-grid">
                <label>{t("settings.companyEdit.nameLabel")}<input type="text" value={form.name} onChange={(e) => set("name", e.target.value)} /></label>
                <label>{t("settings.companyEdit.shortNameLabel")}<input type="text" value={form.shortName} onChange={(e) => set("shortName", e.target.value)} /></label>
                <label>{t("settings.companyEdit.nameEnLabel")}<input type="text" dir="ltr" value={form.nameEn} onChange={(e) => set("nameEn", e.target.value)} /></label>
                <label>
                  {t("settings.newCompany.countryLabel")}
                  <select value={form.country} onChange={(e) => { set("country", e.target.value); set("currency", defaultCurrencyForCountry(e.target.value)); set("vatRate", defaultVatRateForCountry(e.target.value)); }}>
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>{countryName(c.code, i18n.language)}</option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("settings.newCompany.currencyLabel")}
                  <select value={form.currency} onChange={(e) => set("currency", e.target.value)}>
                    {CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code}>{c.code} — {c.symbolAr}</option>
                    ))}
                  </select>
                </label>
                <label>{t("settings.companyEdit.officialEmailLabel")}<input type="email" value={form.officialEmail} onChange={(e) => set("officialEmail", e.target.value)} /></label>
                <label>{t("settings.companyEdit.phoneLabel")}<input type="text" value={form.phone} onChange={(e) => set("phone", e.target.value)} /></label>
              </div>
              <SectionSave section="basic" />
            </section>}
            {has("registration") && <section hidden={activeSection !== "registration"} className="company-settings-section">
              <h4 className="sub-head company-settings-section-title">{t("settings.companyEdit.tabs.registration")}</h4>
              <div className="form-grid">
                <label>{t("settings.companyEdit.crNumberLabel")}<input type="text" value={form.crNumber} onChange={(e) => set("crNumber", e.target.value)} /></label>
                <label>{t("settings.companyEdit.crIssueDateLabel")}<input type="date" value={form.crIssueDate} onChange={(e) => set("crIssueDate", e.target.value)} /></label>
                <label>{t("settings.companyEdit.crExpiryDateLabel")}<input type="date" value={form.crExpiryDate} onChange={(e) => set("crExpiryDate", e.target.value)} /></label>
                <label>{t("settings.companyEdit.unifiedEntityNumberLabel")}<input type="text" value={form.unifiedEntityNumber} onChange={(e) => set("unifiedEntityNumber", e.target.value)} /></label>
                <label>{t("settings.companyEdit.licenseNumberLabel")}<input type="text" value={form.licenseNumber} onChange={(e) => set("licenseNumber", e.target.value)} /></label>
              </div>
              <SectionSave section="registration" />
            </section>}
            {has("tax") && <section hidden={activeSection !== "tax"} className="company-settings-section">
              <h4 className="sub-head company-settings-section-title">{t("settings.companyEdit.tabs.tax")}</h4>
              <div className="form-grid">
                <label>{t("settings.companyEdit.vatNumberLabel")}<input type="text" maxLength={24} dir="ltr" placeholder={vatNumberExampleForCountry(form.country)} value={form.vatNumber} onChange={(e) => set("vatNumber", e.target.value.toUpperCase())} />
                  {form.vatNumber && !isValidVatNumberForCountry(form.vatNumber, form.country)
                    ? <small className="balance-bad">{i18n.language.startsWith("ar") ? `صيغة غير صحيحة لـ${countryName(form.country, "ar")}${vatNumberExampleForCountry(form.country) ? ` — مثال: ${vatNumberExampleForCountry(form.country)}` : ""}` : `Invalid format for ${countryName(form.country, "en")}${vatNumberExampleForCountry(form.country) ? `, e.g. ${vatNumberExampleForCountry(form.country)}` : ""}`}</small>
                    : <small className="note">{vatNumberExampleForCountry(form.country) ? (i18n.language.startsWith("ar") ? `مثال: ${vatNumberExampleForCountry(form.country)}` : `e.g. ${vatNumberExampleForCountry(form.country)}`) : ""}</small>}
                </label>
                <label>{i18n.language.startsWith("ar") ? "نسبة ضريبة القيمة المضافة %" : "VAT rate %"}
                  <input type="number" min="0" max="100" step="0.01" dir="ltr" disabled={form.country === "SA"} value={form.country === "SA" ? 15 : form.vatRate} onChange={(e) => set("vatRate", e.target.value === "" ? "" : Number(e.target.value))} />
                  <small className="note">{form.country === "SA"
                    ? (i18n.language.startsWith("ar") ? "ثابتة 15% للسعودية (زاتكا)." : "Fixed at 15% for Saudi Arabia (ZATCA).")
                    : (i18n.language.startsWith("ar") ? `المقترح لهذه الدولة ${defaultVatRateForCountry(form.country)}%${defaultVatRateForCountry(form.country) === 0 ? " (لا توجد ضريبة عامة)" : ""}. تُطبَّق على المستندات الجديدة فقط.` : `Suggested for this country: ${defaultVatRateForCountry(form.country)}%. Applies to new documents only.`)}</small>
                </label>
                <label>{t("settings.companyEdit.vatFilingFrequencyLabel")}
                  <select value={form.vatFilingFrequency} onChange={(e) => set("vatFilingFrequency", e.target.value)}>
                    <option value="monthly">{t("settings.companyEdit.vatFilingMonthly")}</option>
                    <option value="quarterly">{t("settings.companyEdit.vatFilingQuarterly")}</option>
                  </select>
                </label>
                <label>{t("settings.companyEdit.zakatDueDateLabel")}
                  <input type="date" value={form.zakatDeclarationDueDate} onChange={(e) => set("zakatDeclarationDueDate", e.target.value)} />
                </label>
              </div>
              <SectionSave section="tax" />
            </section>}
            {has("address") && <section hidden={activeSection !== "address"} className="company-settings-section">
              <h4 className="sub-head company-settings-section-title">{t("settings.companyEdit.tabs.address")}</h4>
              <div className="form-grid">
                <label>{t("settings.companyEdit.addressBuilding")}<input type="text" value={form.addressBuilding} onChange={(e) => set("addressBuilding", e.target.value)} /></label>
                <label>{t("settings.companyEdit.addressStreet")}<input type="text" value={form.addressStreet} onChange={(e) => set("addressStreet", e.target.value)} /></label>
                <label>{t("settings.companyEdit.addressDistrict")}<input type="text" value={form.addressDistrict} onChange={(e) => set("addressDistrict", e.target.value)} /></label>
                <label>{t("settings.companyEdit.addressCity")}<input type="text" value={form.addressCity} onChange={(e) => set("addressCity", e.target.value)} /></label>
                <label>{t("settings.companyEdit.addressPostalCode")}<input type="text" value={form.addressPostalCode} onChange={(e) => set("addressPostalCode", e.target.value)} /></label>
                <label>{t("settings.companyEdit.addressAdditionalNo")}<input type="text" value={form.addressAdditionalNo} onChange={(e) => set("addressAdditionalNo", e.target.value)} /></label>
              </div>
              <SectionSave section="address" />
            </section>}
            {has("numbering") && <section hidden={activeSection !== "numbering"} className="company-settings-section">
              <h4 className="sub-head company-settings-section-title">{t("settings.companyEdit.tabs.numbering")}</h4>
              <div className="form-grid">
                <label>
                  {t("settings.companyEdit.numberingPrefixLabel")}
                  <input
                    type="text" maxLength={2}
                    value={form.numberingPrefix}
                    onChange={(e) => set("numberingPrefix", e.target.value.replace(/[^a-zA-Z]/g, "").toUpperCase())}
                    placeholder="J"
                  />
                </label>
              </div>
              <p className="note">{t("settings.companyEdit.numberingPrefixNote")}</p>
              <SectionSave section="numbering" />
            </section>}
            {has("alerts") && <section hidden={activeSection !== "alerts"} className="company-settings-section">
              <h4 className="sub-head company-settings-section-title">{t("settings.companyEdit.tabs.alerts")}</h4>
              <div className="form-grid">
                <label>{t("settings.companyEdit.lowCashThresholdLabel")}
                  <input type="number" value={form.lowCashThreshold} onChange={(e) => set("lowCashThreshold", e.target.value)} placeholder={t("settings.companyEdit.lowCashPlaceholder")} />
                </label>
                <label>{t("settings.companyEdit.overdueInvoiceDaysLabel")}
                  <input type="number" value={form.overdueInvoiceDays} onChange={(e) => set("overdueInvoiceDays", e.target.value)} />
                </label>
                <label>{t("settings.companyEdit.staleDraftDaysLabel")}
                  <input type="number" value={form.staleDraftDays} onChange={(e) => set("staleDraftDays", e.target.value)} />
                </label>
              </div>
              <SectionSave section="alerts" />
            </section>}
            {has("storeGeneral") && <section hidden={activeSection !== "storeGeneral"} className="company-settings-section">
              <h4 className="sub-head company-settings-section-title">{t("settings.companyEdit.tabs.storeGeneral")}</h4>
              <p className="note">{t("settings.companyEdit.storeNote")}</p>
              <label className="checkbox-label">
                <input type="checkbox" checked={Boolean(form.storeEnabled)} onChange={(e) => set("storeEnabled", e.target.checked)} />
                {t("settings.companyEdit.storeEnabledLabel")}
              </label>
              <label className="checkbox-label">
                <input type="checkbox" checked={Boolean(form.storeListed)} onChange={(e) => set("storeListed", e.target.checked)} />
                {t("settings.companyEdit.storeListedLabel")}
              </label>
              <div className="form-grid">
                <label>{t("settings.companyEdit.storeSlugLabel")}
                  <input type="text" dir="ltr" maxLength={40} value={form.storeSlug} placeholder="tism-pro"
                    onChange={(e) => set("storeSlug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} />
                </label>
                <label>{t("settings.companyEdit.storeNameLabel")}<input type="text" maxLength={120} value={form.storeName} onChange={(e) => set("storeName", e.target.value)} /></label>
                <label>{t("settings.companyEdit.storeNameEnLabel")}<input type="text" dir="ltr" maxLength={120} value={form.storeNameEn} onChange={(e) => set("storeNameEn", e.target.value)} /></label>
                <label>{t("settings.companyEdit.storeWhatsappLabel")}
                  <input type="tel" dir="ltr" value={form.storeWhatsappNumber} placeholder="9665XXXXXXXX" onChange={(e) => set("storeWhatsappNumber", e.target.value)} />
                </label>
              </div>
              {baseline.storeEnabled && baseline.storeSlug && (
                <p className="note">{t("settings.companyEdit.storeLinkLabel")}{" "}
                  <a href={`/store/${baseline.storeSlug}`} target="_blank" rel="noreferrer" dir="ltr">{`${window.location.origin}/store/${baseline.storeSlug}`}</a>
                </p>
              )}
              <SectionSave section="storeGeneral" />
            </section>}
            {has("storeAppearance") && <section hidden={activeSection !== "storeAppearance"} className="company-settings-section">
              <p className="note">{t("settings.companyEdit.storeSettings.appearanceNote")}</p>
              <div className="form-grid">
                <label>{t("settings.companyEdit.storeSettings.accentColor")}
                  <span className="store-color-field">
                    <input type="color" value={form.storeAccentColor || "#f5b800"} onChange={(e) => set("storeAccentColor", e.target.value)} />
                    {form.storeAccentColor
                      ? <button type="button" className="btn-ghost" onClick={() => set("storeAccentColor", "")}>{t("settings.companyEdit.storeSettings.accentDefault")}</button>
                      : <span className="note">{t("settings.companyEdit.storeSettings.accentIsDefault")}</span>}
                  </span>
                </label>
              </div>
              <div className="form-grid">
                <label>{t("settings.companyEdit.storeSettings.about")}<textarea rows={3} maxLength={2000} value={form.storeAbout} onChange={(e) => set("storeAbout", e.target.value)} /></label>
                <label>{t("settings.companyEdit.storeSettings.aboutEn")}<textarea rows={3} dir="ltr" maxLength={2000} value={form.storeAboutEn} onChange={(e) => set("storeAboutEn", e.target.value)} /></label>
              </div>
              <div className="form-grid">
                {SOCIAL_KEYS.map((k) => (
                  <label key={k}>{t(`settings.companyEdit.storeSettings.social.${k}`)}
                    <input type="url" dir="ltr" maxLength={200} placeholder="https://" value={form.storeSocial[k] || ""} onChange={(e) => set("storeSocial", { ...form.storeSocial, [k]: e.target.value })} />
                  </label>
                ))}
              </div>
              <AttachmentsPanel entityType="store_banner" entityId={company.id} title={t("settings.companyEdit.storeSettings.banners")} />

              <SectionSave section="storeAppearance" />
            </section>}
            {has("storeShipping") && <section hidden={activeSection !== "storeShipping"} className="company-settings-section">
              <StoreShippingZonesPanel companyId={company.id} />
              <div className="form-grid">
                <label>{t("settings.companyEdit.storeSettings.freeShippingOver")}
                  <input type="number" min="0" step="0.01" dir="ltr" value={form.storeFreeShippingOver} onChange={(e) => set("storeFreeShippingOver", e.target.value)} />
                </label>
                <label>{t("settings.companyEdit.storeSettings.minOrderAmount")}
                  <input type="number" min="0" step="0.01" dir="ltr" value={form.storeMinOrderAmount} onChange={(e) => set("storeMinOrderAmount", e.target.value)} />
                </label>
              </div>
              <label className="checkbox-label">
                <input type="checkbox" checked={Boolean(form.storePickupEnabled)} onChange={(e) => set("storePickupEnabled", e.target.checked)} />
                {t("settings.companyEdit.storeSettings.pickupEnabled")}
              </label>
              {form.storePickupEnabled && (
                <div className="form-grid">
                  <label>{t("settings.companyEdit.storeSettings.pickupAddress")}<input type="text" maxLength={300} value={form.storePickupAddress} onChange={(e) => set("storePickupAddress", e.target.value)} /></label>
                </div>
              )}

              <SectionSave section="storeShipping" />
            </section>}
            {has("storePayment") && <section hidden={activeSection !== "storePayment"} className="company-settings-section">
              <p className="note">{t("settings.companyEdit.storeSettings.paymentNote")}</p>
              <label className="checkbox-label">
                <input type="checkbox" checked={Boolean(form.storeCodEnabled)} onChange={(e) => set("storeCodEnabled", e.target.checked)} />
                {t("settings.companyEdit.storeSettings.codEnabled")}
              </label>
              <label className="checkbox-label">
                <input type="checkbox" checked={Boolean(form.storeBankTransferEnabled)} onChange={(e) => set("storeBankTransferEnabled", e.target.checked)} />
                {t("settings.companyEdit.storeSettings.bankTransferEnabled")}
              </label>
              {form.storeBankTransferEnabled && (
                <div className="form-grid">
                  <label>{t("settings.companyEdit.storeSettings.bankTransferDetails")}<textarea rows={3} maxLength={600} value={form.storeBankTransferDetails} onChange={(e) => set("storeBankTransferDetails", e.target.value)} /></label>
                </div>
              )}

              <SectionSave section="storePayment" />
            </section>}
            {has("storeMarketing") && <section hidden={activeSection !== "storeMarketing"} className="company-settings-section">
              <StoreCouponsPanel companyId={company.id} />
              <div className="form-grid">
                <label>{t("settings.companyEdit.storeSettings.metaPixelId")}
                  <input type="text" dir="ltr" inputMode="numeric" maxLength={20} value={form.storeMetaPixelId} onChange={(e) => set("storeMetaPixelId", e.target.value.replace(/\D/g, ""))} />
                </label>
              </div>
              {baseline.storeEnabled && baseline.storeSlug && (
                <p className="note">{t("settings.companyEdit.storeSettings.feedLabel")}{" "}
                  <a href={storeFeedUrl(baseline.storeSlug)} target="_blank" rel="noreferrer" dir="ltr">{storeFeedUrl(baseline.storeSlug)}</a>
                </p>
              )}

              <SectionSave section="storeMarketing" />
            </section>}
            {has("storePolicies") && <section hidden={activeSection !== "storePolicies"} className="company-settings-section">
              <div className="form-grid">
                <label>{t("settings.companyEdit.storeSettings.returnPolicy")}<textarea rows={5} maxLength={8000} value={form.storeReturnPolicy} onChange={(e) => set("storeReturnPolicy", e.target.value)} /></label>
                <label>{t("settings.companyEdit.storeSettings.privacyPolicy")}<textarea rows={5} maxLength={8000} value={form.storePrivacyPolicy} onChange={(e) => set("storePrivacyPolicy", e.target.value)} /></label>
              </div>
              <SectionSave section="storePolicies" />
            </section>}
            {has("stations") && (
              <section hidden={activeSection !== "stations"} className="company-settings-section">
                <h4 className="sub-head company-settings-section-title">{t("settings.companyEdit.tabs.stations")}</h4>
                <p className="note">{t("settings.companyEdit.stationShiftsNote")}</p>
                <div className="form-grid">
                  <label>{t("settings.companyEdit.stationCashShortageAccountLabel")}
                    <AccountSearchSelect
                      accounts={stationExpenseAccounts}
                      value={form.stationCashShortageAccountId}
                      onChange={(id) => set("stationCashShortageAccountId", id)}
                      allowClear
                    />
                  </label>
                  <label>{t("settings.companyEdit.stationCashSurplusAccountLabel")}
                    <AccountSearchSelect
                      accounts={stationRevenueAccounts}
                      value={form.stationCashSurplusAccountId}
                      onChange={(id) => set("stationCashSurplusAccountId", id)}
                      allowClear
                    />
                  </label>
                  <label>{t("settings.companyEdit.tankVarianceAccountLabel")}
                    <AccountSearchSelect
                      accounts={stationExpenseAccounts}
                      value={form.tankVarianceAccountId}
                      onChange={(id) => set("tankVarianceAccountId", id)}
                      allowClear
                    />
                  </label>
                  <label>{t("settings.companyEdit.cardFeeExpenseAccountLabel")}
                    <AccountSearchSelect
                      accounts={stationExpenseAccounts}
                      value={form.cardFeeExpenseAccountId}
                      onChange={(id) => set("cardFeeExpenseAccountId", id)}
                      allowClear
                    />
                  </label>
                </div>
                <p className="note">{t("settings.companyEdit.stationFuelCostNote")}</p>
                <div className="form-grid">
                  {STATION_FUEL_ITEM_FIELDS.map(([field, labelKey]) => (
                    <label key={field}>{t(`settings.companyEdit.${labelKey}`)}
                      <select value={form[field]} onChange={(e) => set(field, e.target.value)}>
                        <option value="">{t("settings.companyEdit.stationFuelItemNone")}</option>
                        {inventoryItems.map((item) => (
                          <option key={item.id} value={item.id}>{item.code} — {item.name}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <label className="checkbox-label">
                    <input type="checkbox" checked={Boolean(form.allowNegativeFuelStock)} onChange={(e) => set("allowNegativeFuelStock", e.target.checked)} />
                    {t("settings.companyEdit.allowNegativeFuelStockLabel")}
                  </label>
                </div>
                <SectionSave section="stations" />
              </section>
            )}
            {has("fiscal") && <section hidden={activeSection !== "fiscal"} className="company-settings-section">
              <FiscalYearPanel companyId={company.id} onClosingDateChange={(date) => { const d = date ? String(date).slice(0, 10) : ""; set("fiscalYearClosingDate", d); setBaseline((prev) => ({ ...prev, fiscalYearClosingDate: d })); }} />

              <h4 className="sub-head">{t("settings.companyEdit.fiscalClosingTitle")}</h4>
              <p className="note">{t("settings.companyEdit.fiscalClosingNote")}</p>
              <div className="form-grid">
                <label>{t("settings.companyEdit.fiscalClosingDateLabel")}
                  <input type="date" value={form.fiscalYearClosingDate} onChange={(e) => set("fiscalYearClosingDate", e.target.value)} />
                </label>
              </div>
              <SectionSave section="fiscal" />
              {canReopen && (
                <>
                  <h5>{t("settings.companyEdit.reopenTitle")}</h5>
                  <p className="note">{t("settings.companyEdit.reopenNote")}</p>
                  <div className="form-btn-group" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
                    <label>{t("settings.companyEdit.reopenNewDateLabel")}
                      <input type="date" value={reopenDate} onChange={(e) => setReopenDate(e.target.value)} />
                    </label>
                    <button className="btn-ghost" onClick={reopen} disabled={reopening}>
                      {reopening ? t("settings.companyEdit.reopening") : t("settings.companyEdit.reopenBtn")}
                    </button>
                  </div>
                  {reopenNotice && <p className="note">{reopenNotice}</p>}
                  {reopenError && <p className="balance-bad">{reopenError}</p>}
                </>
              )}
            </section>}
            {has("branches") && <section hidden={activeSection !== "branches"} className="company-settings-section">
              <BranchesPanel companyId={company.id} companyCurrency={form.currency} />
            </section>}
            {has("bankAccounts") && <section hidden={activeSection !== "bankAccounts"} className="company-settings-section">
              <CompanyBankAccountsPanel companyId={company.id} />
            </section>}
            {has("leases") && <section hidden={activeSection !== "leases"} className="company-settings-section">
              <LeaseContractsPanel companyId={company.id} />
            </section>}
            {has("documents") && <section hidden={activeSection !== "documents"} className="company-settings-section">
              <CompanyDocumentsPanel companyId={company.id} />
              <h4 className="sub-head">{t("settings.companyEdit.aiExtractTitle")}</h4>
              <p className="note">{t("settings.companyEdit.aiExtractNote")}</p>
              <div className="form-btn-group" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
                {DOC_TYPES.map((d) => (
                  <React.Fragment key={d.key}>
                    <input
                      ref={(el) => (docInputRefs.current[d.key] = el)}
                      type="file" accept="image/*,application/pdf" hidden
                      onChange={(e) => pickDocument(d.key, e)}
                    />
                    <button className="btn-ghost" onClick={() => docInputRefs.current[d.key]?.click()} disabled={extracting !== null}>
                      {extracting === d.key ? t("settings.companyEdit.analyzing") : d.label}
                    </button>
                  </React.Fragment>
                ))}
              </div>
              {extractionNote && (
                <p className={extractionNote.confidence === "low" ? "balance-bad" : "note"}>{extractionNote.text}</p>
              )}
              {extractedKeys.length > 0 && (
                <div className="company-settings-section-save">
                  <span className="note">{t("settings.companyEdit.tabs.extractedPending", { sections: [...new Set(extractedKeys.map((k) => FIELD_SECTION[k]))].map((sec) => t(`settings.companyEdit.tabs.${sec}`)).join("، ") })}</span>
                  <button type="button" className="btn-primary" onClick={saveExtracted} disabled={saving}>
                    {sectionSaving === "documents" ? t("settings.myAccount.saving") : t("settings.companyEdit.tabs.saveExtracted")}
                  </button>
                </div>
              )}
              {sectionStatus.documents && <p className={sectionStatus.documents.ok ? "note" : "balance-bad"}>{sectionStatus.documents.text}</p>}

              <AttachmentsPanel key={attachmentsKey} entityType="company" entityId={company.id} title={t("settings.companyEdit.uploadedDocsTitle")} />
            </section>}
            {has("logo") && <section hidden={activeSection !== "logo"} className="company-settings-section">
              <h4 className="sub-head company-settings-section-title">{t("settings.companyEdit.tabs.logo")}</h4>
              <div className="form-btn-group" style={{ justifyContent: "flex-start" }}>
                {logoUrl && <img src={logoUrl} alt={t("settings.companyEdit.logoAlt")} style={{ height: 44, borderRadius: 6 }} />}
                <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={pickLogo} />
                <button className="btn-ghost" onClick={() => logoInputRef.current?.click()} disabled={uploadingLogo}>
                  {uploadingLogo ? t("settings.companyEdit.uploadingLogo") : logoUrl ? t("settings.companyEdit.changeLogo") : t("settings.companyEdit.uploadLogo")}
                </button>
              </div>
              {error && <p className="balance-bad">{error}</p>}
            </section>}
            {extraSections.map((x) => (
              <section key={x.key} hidden={activeSection !== x.key} className="company-settings-section company-settings-extra">
                {x.render({ goTo: setActiveSection })}
              </section>
            ))}
          </div>
          {sections.some((x) => x.key === activeSection && SECTION_FIELDS[x.key]) && <p className="note company-settings-footer">{t("settings.companyEdit.tabs.saveNote")}</p>}
        </div>
    </div>
  );
}
