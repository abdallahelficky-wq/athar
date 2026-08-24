import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import * as XLSX from "xlsx";
import QRCode from "qrcode";
import { fmt, fmt2, costCenterName, COMPANIES } from "./constants";
import { useAuth } from "../context/AuthContext";

export function Gauge({ label, value, max, unit, tone }) {
  const pct = Math.max(0, Math.min(1, value / max));
  const r = 54;
  const cx = 60, cy = 64;
  const startA = (-120 * Math.PI) / 180;
  const endA = (120 * Math.PI) / 180;
  const arcPoint = (a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const [sx, sy] = arcPoint(startA);
  const [ex, ey] = arcPoint(endA);
  const [px, py] = arcPoint(startA + pct * (endA - startA));

  return (
    <div className="gauge-card">
      <svg viewBox="0 0 120 92" className="gauge-svg">
        <path d={`M ${sx} ${sy} A ${r} ${r} 0 1 1 ${ex} ${ey}`} className="gauge-track" />
        <path
          d={`M ${sx} ${sy} A ${r} ${r} 0 ${pct > 0.708 ? 1 : 0} 1 ${px} ${py}`}
          stroke={tone}
          className="gauge-fill"
        />
        <line x1={cx} y1={cy} x2={px} y2={py} stroke={tone} className="gauge-needle" />
        <circle cx={cx} cy={cy} r="3.4" fill={tone} />
      </svg>
      <div className="gauge-value" style={{ color: tone }}>
        {unit === "ر.س" ? fmt(value) : fmt2(value)} <span className="gauge-unit">{unit}</span>
      </div>
      <div className="gauge-label">{label}</div>
    </div>
  );
}

/* رسم دائري مصغّر (دونات) — لتوزيع نسب حالات المعاملات، بهوية بوصلة/إبرة متسقة مع باقي النظام */
export function MiniDonut({ title, segments }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = 42, cx = 50, cy = 50, circumference = 2 * Math.PI * r;
  let offsetAcc = 0;
  return (
    <div className="analytics-card">
      <div className="analytics-title">{title}</div>
      <div className="mini-donut-row">
        <svg viewBox="0 0 100 100" className="mini-donut-svg">
          <circle r={r} cx={cx} cy={cy} fill="none" stroke="rgba(16,32,46,0.06)" strokeWidth="14" />
          {segments.map((s, i) => {
            const frac = s.value / total;
            const dash = frac * circumference;
            const circle = (
              <circle
                key={i} r={r} cx={cx} cy={cy} fill="none" stroke={s.color} strokeWidth="14"
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offsetAcc}
                transform={`rotate(-90 ${cx} ${cy})`}
                strokeLinecap={segments.length > 1 ? "butt" : "round"}
              />
            );
            offsetAcc += dash;
            return circle;
          })}
          <text x={cx} y={cy + 5} textAnchor="middle" className="mini-donut-total">{total}</text>
        </svg>
        <div className="mini-legend">
          {segments.map((s, i) => (
            <div className="legend-item" key={i}>
              <span className="legend-dot" style={{ background: s.color }} />
              <span className="legend-label">{s.label}</span>
              <span className="legend-value">{s.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* رسم أعمدة مصغّر — لمقارنة قيم بين فئات (طريقة الدفع، الحالة...) */
export function MiniBarChart({ title, bars, valueFormatter }) {
  const maxVal = Math.max(...bars.map((b) => b.value), 1);
  const fmtFn = valueFormatter || ((v) => fmt(v));
  return (
    <div className="analytics-card">
      <div className="analytics-title">{title}</div>
      <div className="mini-bar-chart">
        {bars.map((b, i) => (
          <div className="mini-bar-col" key={i}>
            <div className="mini-bar-value">{fmtFn(b.value)}</div>
            <div className="mini-bar-track"><div className="mini-bar-fill" style={{ height: `${(b.value / maxVal) * 100}%`, background: b.color }} /></div>
            <div className="mini-bar-label">{b.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============ لوحة القيادة ============ */
export const Icon = {
  Eye: () => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" /></svg>,
  Printer: () => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9V2h12v7" /><rect x="4" y="9" width="16" height="8" rx="1" /><path d="M6 17h12v5H6z" /></svg>,
  Download: () => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v12m0 0l-4-4m4 4l4-4" /><path d="M4 19h16" /></svg>,
  Edit: () => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>,
  Trash: () => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18" /><path d="M8 6V4h8v2M6 6l1 15h10l1-15" /></svg>,
  Lock: () => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>,
  Unlock: () => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V7a4 4 0 0 1 7.2-2.4" /></svg>,
  Copy: () => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="12" height="12" rx="1.5" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>,
  Link: () => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 15l6-6" /><path d="M11 5.5l1-1a3.5 3.5 0 0 1 5 5l-1 1" /><path d="M13 18.5l-1 1a3.5 3.5 0 0 1-5-5l1-1" /></svg>,
  Unlink: () => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 15l1.5-1.5" /><path d="M13.5 10.5L15 9" /><path d="M11 5.5l1-1a3.5 3.5 0 0 1 5 5l-1 1" /><path d="M13 18.5l-1 1a3.5 3.5 0 0 1-5-5l1-1" /><path d="M3 3l18 18" /></svg>,
  BookOpen: () => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5c-2-1.5-5-2-8-1.5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-13c-3-.5-6 0-8 1.5z" /><path d="M12 5v13" /></svg>,
  Convert: () => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 12h11" /><path d="M11 7l5 5-5 5" /><rect x="16" y="4" width="5" height="16" rx="1" /></svg>,
  Mail: () => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M2 6l10 7 10-7" /></svg>,
  Refresh: () => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></svg>,
  Receipt: () => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2z" /><path d="M9 7h6M9 11h6M9 15h4" /></svg>,
  MoreVertical: () => <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" stroke="none"><circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" /></svg>,
  Paperclip: () => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 11.5L12.5 20a4.5 4.5 0 0 1-6.4-6.4l8.5-8.5a3 3 0 0 1 4.3 4.3l-8.5 8.5a1.5 1.5 0 0 1-2.1-2.1l7.8-7.8" /></svg>,
};

export function downloadCsv(filename, rows) {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  downloadBlob(blob, filename);
}

/** \u062A\u062D\u0645\u064A\u0644 \u0623\u064A Blob (PDF \u0645\u062B\u0644\u0627\u064B) \u0643\u0645\u0644\u0641 \u0641\u0639\u0644\u064A \u2014 \u0646\u0641\u0633 \u0622\u0644\u064A\u0629 downloadCsv \u0623\u0639\u0644\u0627\u0647\u060C \u0645\u0639\u0645\u064E\u0651\u0645\u0629 \u0644\u0623\u064A \u0646\u0648\u0639 \u0645\u0644\u0641. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ExcelImportPanel({ title, exampleRows, onImportRows }) {
  const [importMsg, setImportMsg] = useState("");

  const downloadTemplate = () => {
    const ws = XLSX.utils.json_to_sheet(exampleRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "نموذج");
    XLSX.writeFile(wb, `${title}.xlsx`);
  };

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target.result);
        const wb = XLSX.read(data, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        setImportMsg(onImportRows(rows));
      } catch (err) {
        setImportMsg("تعذّرت قراءة الملف: " + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  return (
    <div className="panel excel-import-panel">
      <h3>استيراد {title} من إكسل</h3>
      <div className="form-btn-group">
        <button className="btn-ghost" onClick={downloadTemplate}>تحميل نموذج إكسل فارغ</button>
        <label className="btn-primary file-upload-btn">
          رفع ملف إكسل
          <input type="file" accept=".xlsx,.xls" onChange={handleFile} style={{ display: "none" }} />
        </label>
      </div>
      {importMsg && <p className="note">{importMsg}</p>}
    </div>
  );
}

export function TxIconBar({ onView, onPrint, onExcel, onEdit, onDelete, onPost, onUnpost, posted }) {
  return (
    <div className="tx-icon-bar">
      {onView && <button className="icon-btn" title="عرض" onClick={onView}><Icon.Eye /></button>}
      {onPrint && <button className="icon-btn" title="طباعة" onClick={onPrint}><Icon.Printer /></button>}
      {onExcel && <button className="icon-btn" title="تحميل Excel" onClick={onExcel}><Icon.Download /></button>}
      {onEdit && <button className="icon-btn" title="تعديل" onClick={onEdit} disabled={posted}><Icon.Edit /></button>}
      {onDelete && <button className="icon-btn icon-btn-danger" title="حذف" onClick={onDelete} disabled={posted}><Icon.Trash /></button>}
      {onPost && !posted && <button className="icon-btn" title="ترحيل" onClick={onPost}><Icon.Lock /></button>}
      {onUnpost && posted && <button className="icon-btn icon-btn-warn" title="فك الترحيل" onClick={onUnpost}><Icon.Unlock /></button>}
    </div>
  );
}

/* لوحة تأكيد بسيطة تطلب الرقم السري قبل فك ترحيل أي معاملة */
export function UnpostConfirm({ onConfirm, onCancel, unlockPin }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const submit = () => {
    if (pin !== unlockPin) { setError(true); return; }
    onConfirm();
  };
  return (
    <div className="unpost-confirm-overlay">
      <div className="unpost-confirm-box">
        <h3>فك ترحيل المعاملة</h3>
        <p className="note">أدخل الرقم السري لتأكيد فك الترحيل. سيتم حذف القيد المحاسبي المرتبط بهذه المعاملة.</p>
        <input type="password" value={pin} onChange={(e) => { setPin(e.target.value); setError(false); }} placeholder="الرقم السري" />
        {error && <p className="balance-bad">رقم سري غير صحيح.</p>}
        <div className="form-btn-group">
          <button className="btn-ghost" onClick={onCancel}>إلغاء</button>
          <button className="btn-primary" onClick={submit}>تأكيد فك الترحيل</button>
        </div>
      </div>
    </div>
  );
}

export function QrImage({ payload, size = 150 }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    if (payload) {
      QRCode.toDataURL(payload, { margin: 1, width: size }).then((url) => { if (!cancelled) setSrc(url); }).catch(() => setSrc(null));
    }
    return () => { cancelled = true; };
  }, [payload, size]);
  if (!src) return <div className="qr-loading">جارِ توليد رمز QR...</div>;
  return <img src={src} alt="QR Code" className="qr-image" width={size} height={size} />;
}

export function printWithOrientation(landscape) {
  const id = "temp-orientation-style";
  let styleEl = document.getElementById(id);
  if (landscape) {
    if (!styleEl) { styleEl = document.createElement("style"); styleEl.id = id; document.body.appendChild(styleEl); }
    else { document.body.appendChild(styleEl); } // move to end so it wins the cascade over the component's own static @page rule
    styleEl.textContent = "@page { size: landscape; margin: 10mm; }";
  } else if (styleEl) {
    styleEl.remove();
  }
  window.print();
}

/** يبني سطر عنوان وطني مختصر من الحقول المنفصلة، متجاهلاً أي حقل فارغ */
export function formatCompanyAddress(company, { full = false } = {}) {
  if (!company) return "";
  const parts = [];
  if (company.addressStreet) parts.push(company.addressStreet);
  if (company.addressDistrict) parts.push(`حي ${company.addressDistrict}`);
  if (company.addressCity) parts.push(company.addressCity);
  if (full) {
    if (company.addressBuilding) parts.unshift(`مبنى ${company.addressBuilding}`);
    if (company.addressPostalCode) parts.push(company.addressPostalCode);
    if (company.addressAdditionalNo) parts.push(`إضافي ${company.addressAdditionalNo}`);
  }
  return parts.join("، ");
}

/**
 * الهيدر/الفوتر المشترَكان لكل مطبوعات النظام — يُدرَجان هنا داخل PrintShell نفسه (نقطة
 * الدخول المشتركة الوحيدة لأي شاشة طباعة حالية أو مستقبلية) بدل تكرارهما في كل شاشة على
 * حدة، حتى ينطبق أي تعديل مستقبلي عليهما تلقائياً على كل المطبوعات دفعة واحدة.
 */
export function PrintShell({ subtitle, refNode, children, onClose, onEdit, onDownload, showSignatures = true, company, landscape = false }) {
  const { user } = useAuth();
  const [printedAt, setPrintedAt] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const accent = company?.brandColor || "#10202E";
  const displayName = company && company.id !== "all" ? (company.shortName || company.name) : "أثر المحاسبي";
  const address = formatCompanyAddress(company);

  const handlePrint = () => {
    setPrintedAt(new Date());
    // تأخير بسيط حتى يُحدَّث الفوتر بوقت الطباعة الفعلي في DOM قبل استدعاء window.print()
    setTimeout(() => printWithOrientation(landscape), 30);
  };

  // لو الطرف المستدعي مرّر onDownload (تحميل PDF حقيقي من الخادم)، زر "تحميل PDF" يستخدمه بدل
  // window.print() — بدون تمريره، الزر يبقى بسلوكه الأصلي (نافذة الطباعة) لبقية المستندات
  // (فواتير/بطاقات أصول) التي لا تملك بعد مساراً مماثلاً لتوليد PDF حقيقي على الخادم.
  const handleDownloadClick = async () => {
    if (!onDownload) { handlePrint(); return; }
    setDownloading(true);
    try {
      await onDownload();
    } finally {
      setDownloading(false);
    }
  };

  return createPortal(
    <div className="voucher-overlay" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="voucher-shell">
        {onClose && <button type="button" className="voucher-close-x" onClick={onClose} aria-label="إغلاق">×</button>}
        <div className="voucher-print">
          {/* ترتيب الرأس مطلوب صراحة بهذا الشكل الثابت (يمين→يسار): رقم المستند وتاريخه، ثم
              الشعار في المنتصف تماماً، ثم بيانات الشركة — عبر شبكة ثلاثية الأعمدة (لا flex
              بمسافة متساوية) حتى يبقى الشعار في المنتصف الهندسي الدقيق بصرف النظر عن اختلاف
              عرض النص على الجانبين */}
          <div className="voucher-head" style={{ borderBottomColor: accent }}>
            <div className="voucher-ref">{refNode}</div>
            <div className="voucher-logo-wrap">
              {company?.logoUrl ? (
                <img src={company.logoUrl} alt={displayName} className="voucher-logo-img" />
              ) : (
                <div className="brand-mark voucher-mark" style={{ borderColor: accent }}>
                  <span className="brand-mark-needle" style={{ background: accent }} />
                </div>
              )}
            </div>
            <div className="voucher-company-info">
              <div className="voucher-brand-name">{displayName}</div>
              <div className="voucher-brand-sub">{subtitle}</div>
              {company?.vatNumber && <div className="voucher-brand-meta">الرقم الضريبي: {company.vatNumber}</div>}
              {address && <div className="voucher-brand-meta">{address}</div>}
            </div>
          </div>

          {children}

          {showSignatures && (
            <div className="voucher-signatures">
              <div className="sig-box"><span>أعدّه</span><div className="sig-line" /></div>
              <div className="sig-box"><span>اعتمده</span><div className="sig-line" /></div>
              <div className="sig-box"><span>الختم</span><div className="sig-stamp">مكان الختم المعتمد</div></div>
            </div>
          )}

          <div className="voucher-print-footer">
            <span>طُبع بواسطة: {user?.name || "—"}</span>
            <span>{(printedAt || new Date()).toLocaleString("ar-SA")}</span>
          </div>
        </div>

        <div className="voucher-actions">
          {onEdit && <button className="btn-ghost" onClick={onEdit}>تعديل</button>}
          <button className="btn-ghost" onClick={handlePrint}>طباعة</button>
          <button className="btn-primary" onClick={handleDownloadClick} disabled={downloading}>{downloading ? "جارٍ التحميل..." : "تحميل PDF"}</button>
          <button className="btn-ghost" onClick={onClose}>إغلاق</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function VoucherModal({ entry, onClose, onEdit }) {
  if (!entry) return null;
  const company = COMPANIES.find((c) => c.id === entry.company);
  const total = entryTotal(entry);

  return (
    <PrintShell
      subtitle="سند قيد محاسبي"
      refNode={
        <>
          <div>رقم القيد: <strong>{String(entry.id).padStart(5, "0")}</strong></div>
          <div>التاريخ: <strong>{entry.date}</strong></div>
        </>
      }
      onClose={onClose}
      onEdit={() => onEdit(entry)}
      company={COMPANIES.find((c) => c.id === entry.company)}
    >
      <div className="voucher-meta">
        <div><span>الشركة</span><strong>{company?.name}</strong></div>
        <div><span>البيان</span><strong>{entry.memo || "بدون بيان"}</strong></div>
      </div>

      <table className="ledger-table voucher-table">
        <thead>
          <tr><th>الحساب</th><th>مركز التكلفة</th><th>القسم</th><th>مدين</th><th>دائن</th></tr>
        </thead>
        <tbody>
          {entry.lines.map((l, i) => (
            <tr key={i}>
              <td>{l.account}</td>
              <td>{costCenterName(l.costCenter)}</td>
              <td>{l.department || "—"}</td>
              <td className="num">{l.debit ? fmt(l.debit) : "—"}</td>
              <td className="num">{l.credit ? fmt(l.credit) : "—"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td className="foot-label" colSpan={3}>الإجمالي</td><td className="num strong">{fmt(total)}</td><td className="num strong">{fmt(total)}</td></tr>
        </tfoot>
      </table>
    </PrintShell>
  );
}
