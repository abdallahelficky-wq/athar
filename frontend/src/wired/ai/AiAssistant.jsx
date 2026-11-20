import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { askAi, getAiInsights, getAiSignals } from "../../api/ai";
import "../../styles/ai-assistant.css";

const MAX_HISTORY = 8;
const METRICS = ["revenue", "expense", "netCashFlow", "sales"];

function useNumberFormat() {
  const { i18n } = useTranslation();
  return useMemo(() => {
    const f = new Intl.NumberFormat(i18n.language === "en" ? "en-US" : "ar-SA-u-nu-latn", { maximumFractionDigits: 0 });
    return (n) => f.format(Number(n) || 0);
  }, [i18n.language]);
}

/** رسالة خطأ مفهومة بدل نص تقني: الحد الأقصى للاستخدام، الصلاحية، تعذّر المزوّد. */
function useErrorText() {
  const { t } = useTranslation();
  return (err) => {
    if (err?.status === 429) return t("aiAssistant.errLimit");
    if (err?.status === 403) return t("aiAssistant.errForbidden");
    if (err?.status === 502 || err?.status === 504) return t("aiAssistant.errProvider");
    return t("aiAssistant.errGeneric");
  };
}

const ltr = (s) => `⁦${s}⁩`;

function ChatTab({ companyId }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages, busy]);
  // تغيير الشركة يبدأ محادثة جديدة: لا يُحمَل سياق شركة سابقة إلى شركة أخرى.
  useEffect(() => { setMessages([]); }, [companyId]);

  const send = useCallback(async (text) => {
    const question = text.trim();
    if (!question || busy) return;
    const history = messages.filter((m) => !m.error).slice(-MAX_HISTORY).map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setDraft("");
    setBusy(true);
    try {
      const res = await askAi(question, { companyId, history });
      setMessages((prev) => [...prev, { role: "assistant", content: res.answer }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "assistant", content: errorText(err), error: true }]);
    } finally { setBusy(false); }
  }, [busy, companyId, messages, errorText]);

  const suggestions = [t("aiAssistant.s1"), t("aiAssistant.s2"), t("aiAssistant.s3")];
  return (
    <div className="ai-tab">
      <div className="ai-messages" aria-live="polite">
        {messages.length === 0 && (
          <div className="ai-empty">
            <p>{t("aiAssistant.welcome")}</p>
            <div className="ai-suggestions">
              {suggestions.map((s) => <button key={s} type="button" onClick={() => send(s)}>{s}</button>)}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`ai-msg ai-msg-${m.role}${m.error ? " is-error" : ""}`}>{m.content}</div>
        ))}
        {busy && <div className="ai-msg ai-msg-assistant ai-typing">{t("aiAssistant.thinking")}</div>}
        <div ref={endRef} />
      </div>
      <form className="ai-composer" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
        <textarea
          value={draft} rows={2} maxLength={4000} placeholder={t("aiAssistant.placeholder")}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(draft); } }}
        />
        <button type="submit" disabled={busy || !draft.trim()}>{t("aiAssistant.send")}</button>
      </form>
      <p className="ai-note">{t("aiAssistant.note")}</p>
    </div>
  );
}

function InsightsTab({ companyId }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [state, setState] = useState({ status: "idle" });
  useEffect(() => { setState({ status: "idle" }); }, [companyId]);
  const run = async () => {
    setState({ status: "loading" });
    try { setState({ status: "done", text: (await getAiInsights(companyId)).answer }); }
    catch (err) { setState({ status: "error", text: errorText(err) }); }
  };
  return (
    <div className="ai-tab ai-scroll">
      <p className="ai-hint">{t("aiAssistant.insightsHint")}</p>
      <button type="button" className="ai-primary" onClick={run} disabled={state.status === "loading"}>
        {state.status === "loading" ? t("aiAssistant.analyzing") : state.status === "done" ? t("aiAssistant.reanalyze") : t("aiAssistant.analyzeNow")}
      </button>
      {state.status === "error" && <div className="ai-msg ai-msg-assistant is-error">{state.text}</div>}
      {state.status === "done" && <div className="ai-report">{state.text}</div>}
      <p className="ai-note">{t("aiAssistant.note")}</p>
    </div>
  );
}

function useSignals(companyId, active) {
  const [state, setState] = useState({ status: "idle", data: null });
  const [nonce, setNonce] = useState(0);
  const loadedKey = useRef(null);
  useEffect(() => {
    const key = `${companyId ?? "all"}:${nonce}`;
    if (!active || loadedKey.current === key) return;
    loadedKey.current = key;
    let cancelled = false;
    setState({ status: "loading", data: null });
    getAiSignals(companyId)
      .then((data) => { if (!cancelled) setState({ status: "done", data }); })
      .catch(() => { if (!cancelled) setState({ status: "error", data: null }); });
    return () => { cancelled = true; loadedKey.current = null; };
  }, [companyId, active, nonce]);
  return [state, () => setNonce((n) => n + 1)];
}

function ForecastTab({ state, retry }) {
  const { t } = useTranslation();
  const fmt = useNumberFormat();
  if (state.status === "loading" || state.status === "idle") return <div className="ai-tab ai-scroll"><p className="ai-hint">{t("aiAssistant.loading")}</p></div>;
  if (state.status === "error") return <div className="ai-tab ai-scroll"><p className="ai-hint">{t("aiAssistant.errGeneric")}</p><button type="button" className="ai-primary" onClick={retry}>{t("aiAssistant.retry")}</button></div>;
  const { forecasts } = state.data;
  return (
    <div className="ai-tab ai-scroll">
      <p className="ai-hint">{t("aiAssistant.forecastHint")}</p>
      {METRICS.map((metric) => {
        const f = forecasts[metric];
        return (
          <section key={metric} className="ai-card">
            <header>
              <b>{t(`aiAssistant.metric.${metric}`)}</b>
              {f && <span className={`ai-badge ai-conf-${f.confidence}`}>{t(`aiAssistant.confidence.${f.confidence}`)}</span>}
            </header>
            {!f ? <p className="ai-muted">{t("aiAssistant.noForecast")}</p> : (
              <>
                <table>
                  <thead><tr><th>{t("aiAssistant.month")}</th><th>{t("aiAssistant.expected")}</th><th>{t("aiAssistant.range")}</th></tr></thead>
                  <tbody>
                    {f.points.map((p) => (
                      <tr key={p.month}><td>{ltr(p.month)}</td><td><b>{fmt(p.value)}</b></td><td className="ai-muted">{ltr(`${fmt(p.low)} – ${fmt(p.high)}`)}</td></tr>
                    ))}
                  </tbody>
                </table>
                <p className="ai-muted">{t("aiAssistant.trend", { pct: ltr(`${f.trendPct > 0 ? "+" : ""}${f.trendPct}%`) })}</p>
              </>
            )}
          </section>
        );
      })}
      <p className="ai-note">{t("aiAssistant.forecastNote")}</p>
    </div>
  );
}

function AlertsTab({ state, retry }) {
  const { t } = useTranslation();
  const fmt = useNumberFormat();
  if (state.status === "loading" || state.status === "idle") return <div className="ai-tab ai-scroll"><p className="ai-hint">{t("aiAssistant.loading")}</p></div>;
  if (state.status === "error") return <div className="ai-tab ai-scroll"><p className="ai-hint">{t("aiAssistant.errGeneric")}</p><button type="button" className="ai-primary" onClick={retry}>{t("aiAssistant.retry")}</button></div>;
  const { anomalies, duplicates } = state.data;
  return (
    <div className="ai-tab ai-scroll">
      <section className="ai-card">
        <header><b>{t("aiAssistant.anomalies")}</b><span className="ai-badge">{anomalies.length}</span></header>
        {anomalies.length === 0 ? <p className="ai-muted">{t("aiAssistant.noAnomalies")}</p> : (
          <ul className="ai-list">
            {anomalies.map((a) => (
              <li key={`${a.metric}-${a.month}`} className={a.direction === "high" ? "is-high" : "is-low"}>
                <b>{t(`aiAssistant.metric.${a.metric}`)}</b> · {ltr(a.month)}
                <span>{t(a.direction === "high" ? "aiAssistant.aboveUsual" : "aiAssistant.belowUsual", { value: fmt(a.value), expected: fmt(a.expected) })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="ai-card">
        <header><b>{t("aiAssistant.duplicates")}</b><span className="ai-badge">{duplicates.items.length}</span></header>
        {duplicates.items.length === 0 ? <p className="ai-muted">{t("aiAssistant.noDuplicates")}</p> : (
          <ul className="ai-list">
            {duplicates.items.map((d) => (
              <li key={d.entryIds.join("-")} className="is-high">
                <b>{ltr(d.entryNumbers.join(" ، "))}</b>
                <span>{t("aiAssistant.duplicateLine", { date: ltr(d.date), total: fmt(d.total) })}</span>
              </li>
            ))}
          </ul>
        )}
        {duplicates.truncated && <p className="ai-muted">{t("aiAssistant.scanTruncated", { n: duplicates.scanned })}</p>}
      </section>
      <p className="ai-note">{t("aiAssistant.anomalyNote")}</p>
    </div>
  );
}

/** «أثر الذكي»: زر عائم يفتح لوحة بأربع أدوات. يُركَّب مرة واحدة في هيكل التطبيق فيظهر في كل الشاشات. */
export default function AiAssistant({ companyId }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("chat");
  const [signals, resetSignals] = useSignals(companyId, open && (tab === "forecast" || tab === "alerts"));
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  const tabs = [["chat", t("aiAssistant.tabChat")], ["insights", t("aiAssistant.tabInsights")], ["forecast", t("aiAssistant.tabForecast")], ["alerts", t("aiAssistant.tabAlerts")]];
  return (
    <div className="ai-root">
      {open && (
        <section className="ai-panel" role="dialog" aria-label={t("aiAssistant.title")}>
          <header className="ai-head">
            <div><b>{t("aiAssistant.title")}</b><small>{t("aiAssistant.subtitle")}</small></div>
            <button type="button" className="ai-close" aria-label={t("aiAssistant.close")} onClick={() => setOpen(false)}>×</button>
          </header>
          <nav className="ai-tabs" role="tablist">
            {tabs.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "is-on" : ""} onClick={() => setTab(id)}>{label}</button>
            ))}
          </nav>
          {tab === "chat" && <ChatTab companyId={companyId} />}
          {tab === "insights" && <InsightsTab companyId={companyId} />}
          {tab === "forecast" && <ForecastTab state={signals} retry={resetSignals} />}
          {tab === "alerts" && <AlertsTab state={signals} retry={resetSignals} />}
        </section>
      )}
      <button type="button" className="ai-fab" aria-expanded={open} aria-label={t("aiAssistant.title")} onClick={() => setOpen((v) => !v)}>
        <span aria-hidden="true">✦</span><b>{t("aiAssistant.fab")}</b>
      </button>
    </div>
  );
}
