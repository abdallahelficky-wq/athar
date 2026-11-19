import React, { useEffect, useRef, useState } from "react";
import * as api from "../../api/leaseContracts";
import LeaseDialog from "./LeaseDialog";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const splitEmails = (text) => (text || "").split(/[\s,،;]+/).map((x) => x.trim()).filter(Boolean);

/** إدارة العلامات التجارية للشركة: إضافة، تعديل الاسم واللون، إيقاف، وحذف غير المستخدمة */
export function LeaseBrandsDialog({ open, onClose, companyId, brands, onChanged, t }) {
  const [draft, setDraft] = useState({ name: "", nameEn: "", color: "#0D4A31" });
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { if (open) { setError(""); setEditing(null); } }, [open]);
  const act = async (fn) => {
    setError("");
    try { await fn(); await onChanged(); } catch (e) { setError(e.message); }
  };
  const add = () => act(async () => {
    await api.createLeaseBrand({ companyId, name: draft.name.trim(), nameEn: draft.nameEn.trim() || null, color: draft.color });
    setDraft({ name: "", nameEn: "", color: "#0D4A31" });
  });
  const saveEdit = () => act(async () => {
    await api.updateLeaseBrand(editing.id, { name: editing.name.trim(), nameEn: editing.nameEn?.trim() || null, color: editing.color || null });
    setEditing(null);
  });

  return (
    <LeaseDialog open={open} title={t("leases.brands.title")} onClose={onClose} tone="ejar" width={860}>
      <p className="note">{t("leases.brands.note")}</p>
      <div className="ls-brands">
        {brands.map((b) => (editing?.id === b.id ? (
          <div key={b.id} className="ls-brand-row is-edit">
            <input type="color" value={editing.color || "#0D4A31"} onChange={(e) => setEditing({ ...editing, color: e.target.value })} />
            <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <input dir="ltr" value={editing.nameEn || ""} placeholder="English" onChange={(e) => setEditing({ ...editing, nameEn: e.target.value })} />
            <button className="ls-act is-primary" onClick={saveEdit}>{t("common.save")}</button>
            <button className="ls-act" onClick={() => setEditing(null)}>{t("common.cancel")}</button>
          </div>
        ) : (
          <div key={b.id} className={`ls-brand-row${b.isActive ? "" : " is-off"}`}>
            <span className="ls-brand-dot" style={{ background: b.color || "#8896A4" }} />
            <b>{b.name}</b>
            <span className="ls-sub" dir="ltr">{b.nameEn || ""}</span>
            <span className="ls-tag">{t("leases.brands.contracts", { count: b.contractCount || 0 })}</span>
            {!b.isActive && <span className="ls-tag is-warn">{t("leases.brands.inactive")}</span>}
            <span className="ls-view-spacer" />
            <button className="ls-act" onClick={() => setEditing({ ...b })}>{t("common.edit")}</button>
            <button className="ls-act" onClick={() => act(() => api.updateLeaseBrand(b.id, { isActive: !b.isActive }))}>{b.isActive ? t("leases.brands.deactivate") : t("leases.brands.activate")}</button>
            {!b.contractCount && <button className="ls-act is-danger" onClick={() => window.confirm(t("leases.brands.confirmDelete", { name: b.name })) && act(() => api.deleteLeaseBrand(b.id))}>{t("common.delete")}</button>}
          </div>
        )))}
      </div>
      <div className="ld-section-title">{t("leases.brands.add")}</div>
      <div className="ls-brand-row is-edit">
        <input type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
        <input value={draft.name} placeholder={t("leases.brands.name")} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <input dir="ltr" value={draft.nameEn} placeholder="English" onChange={(e) => setDraft({ ...draft, nameEn: e.target.value })} />
        <button className="ls-act is-primary" disabled={draft.name.trim().length < 2} onClick={add}>+ {t("common.add")}</button>
      </div>
      {error && <p className="balance-bad">{error}</p>}
      <div className="form-btn-group"><button className="btn-ghost" onClick={onClose}>{t("common.close")}</button></div>
    </LeaseDialog>
  );
}

/** صفحة الخطاب للطباعة: A4 من اليمين لليسار، كل سطر من النص كما هو */
function letterHtml(subject, body) {
  const lines = esc(body).split("\n").map((l) => (l.trim() ? `<p>${l}</p>` : "<p class=\"gap\"></p>")).join("");
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=swap" rel="stylesheet">
<style>@page{size:A4;margin:22mm 20mm}body{font-family:'IBM Plex Sans Arabic',Tahoma,sans-serif;font-size:12.5pt;line-height:1.9;color:#111;direction:rtl;text-align:right}
p{margin:0}p.gap{height:.8em}</style></head><body>${lines}</body></html>`;
}

/** خطاب إشعار المؤجر بالتجديد أو بعدم التجديد: يولّده النظام من بيانات العقد، يُعدَّل، يُطبع، ويُرسَل للمسؤول في الشركة */
export function LeaseNoticeDialog({ contract, initialKind, onClose, onDone, t, fmtDay }) {
  const [kind, setKind] = useState(initialKind || (contract?.autoRenew ? "termination" : "renewal"));
  const [form, setForm] = useState({ subject: "", body: "", emails: "", loading: true });
  const [history, setHistory] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const printRef = useRef(null);

  useEffect(() => {
    if (!contract) return;
    setError("");
    setForm((f) => ({ ...f, loading: true }));
    api.previewLeaseNotice(contract.id, kind)
      .then((p) => setForm((f) => ({ subject: p.subject, body: p.body, emails: f.emails || p.recipientEmails.join("\n"), deadline: p.noticeDeadline, loading: false })))
      .catch((e) => { setError(e.message); setForm((f) => ({ ...f, loading: false })); });
  }, [contract?.id, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (contract) api.listLeaseNotices(contract.id).then(setHistory).catch(() => setHistory([])); }, [contract?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const print = (subject = form.subject, body = form.body) => {
    const frame = printRef.current;
    if (!frame) return;
    frame.onload = () => { const w = frame.contentWindow; (w.document.fonts?.ready || Promise.resolve()).then(() => w.print()); };
    frame.srcdoc = letterHtml(subject, body);
  };
  const save = async (send) => {
    setError("");
    const recipientEmails = splitEmails(form.emails);
    if (send && !recipientEmails.length) { setError(t("leases.notice.needRecipient")); return; }
    setBusy(true);
    try {
      await api.createLeaseNotice(contract.id, { kind, subject: form.subject.trim(), body: form.body.trim(), recipientEmails, send });
      onDone(send ? t("leases.notice.sentOk", { count: recipientEmails.length }) : t("leases.notice.savedOk"));
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <LeaseDialog open={!!contract} title={`${t("leases.notice.title")} — ${contract?.title || ""}`} onClose={onClose} tone={kind === "termination" ? "red" : "green"} width={980}>
      <p className="note">{t("leases.notice.note")}</p>
      <div className="ld-tiles ls-notice-kinds">
        {["renewal", "termination"].map((k) => (
          <button key={k} type="button" className={`ld-tile nk-${k}${kind === k ? " is-on" : ""}`} onClick={() => setKind(k)}>
            <span className="ld-tile-name"><span className="ld-dot" />{t(`leases.notice.kinds.${k}`)}</span>
            <span className="ld-tile-hint">{t(`leases.notice.hints.${k}`)}</span>
          </button>
        ))}
      </div>
      {form.deadline && <p className="ls-notice-deadline">{t("leases.notice.deadline", { date: fmtDay(form.deadline) })}</p>}
      <label>{t("leases.notice.subject")}<input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} disabled={form.loading} /></label>
      <label>{t("leases.notice.body")}<textarea className="ls-letter" rows={18} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} disabled={form.loading} /></label>
      <label>{t("leases.notice.recipients")}<textarea rows={3} style={{ direction: "ltr" }} value={form.emails} onChange={(e) => setForm({ ...form, emails: e.target.value })} /></label>
      {history.length > 0 && (
        <>
          <div className="ld-section-title">{t("leases.notice.history")}</div>
          <div className="ld-history">
            {history.map((n) => (
              <div key={n.id} className={`ld-history-item nk-${n.kind}`}>
                <span className="ld-dot" /><span className="ld-history-date">{fmtDay(n.letterDate)}</span>
                <span className="ld-history-status">{t(`leases.notice.kinds.${n.kind}`)}</span>
                <span>{n.sentAt ? t("leases.notice.sentTo", { emails: n.recipientEmails.join("، ") }) : t("leases.notice.notSent")}</span>
                <button type="button" className="ls-link" onClick={() => print(n.subject, n.body)}>{t("common.print")}</button>
              </div>
            ))}
          </div>
        </>
      )}
      {error && <p className="balance-bad">{error}</p>}
      <iframe ref={printRef} title="letter" style={{ position: "absolute", width: 0, height: 0, border: 0 }} />
      <div className="form-btn-group" style={{ flexWrap: "wrap" }}>
        <button className="btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
        <button className="btn-ghost" disabled={form.loading} onClick={() => print()}>{t("leases.notice.print")}</button>
        <button className="btn-ghost" disabled={form.loading || busy} onClick={() => save(false)}>{t("leases.notice.saveOnly")}</button>
        <button className="btn-primary" disabled={form.loading || busy} onClick={() => save(true)}>{t("leases.notice.send")}</button>
      </div>
    </LeaseDialog>
  );
}
