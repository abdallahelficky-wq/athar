import React from "react";
import source from "../legal/dataProtection.md?raw";

// وثيقة "حماية بيانات العملاء" — المصدر الوحيد لنصّها هو src/legal/dataProtection.md (النص + رقم الإصدار
// + تاريخ آخر تحديث في رأس الملف معاً)، ولا يُكرَّر أي جزء منه في ملفات الترجمة أو أي شاشة أخرى. أي
// تعديل على النص يستلزم رفع version وlastUpdated في رأس الملف نفسه، لأن آلية الموافقة المستقبلية
// ستشير إلى إصدار بعينه. الصفحة عربية دائماً بصرف النظر عن لغة الواجهة المختارة.

function parseFrontMatter(raw) {
  raw = raw.replace(/\r\n?/g, "\n");
  const match = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error("dataProtection.md: رأس الملف (version/lastUpdated) مفقود");
  const meta = Object.fromEntries(
    match[1].split("\n").map((line) => {
      const i = line.indexOf(":");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    })
  );
  if (!meta.version || !meta.lastUpdated) throw new Error("dataProtection.md: version وlastUpdated مطلوبان");
  return { meta, body: raw.slice(match[0].length) };
}

// **عريض** داخل السطر — الصيغة الوحيدة المستخدمة داخل فقرات الوثيقة.
function inline(text) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part
  );
}

const cells = (row) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

// محوّل Markdown مصغّر لما تستخدمه الوثيقة فقط: عناوين #/##، فقرات، قوائم "- "، جدول، وفاصل "---".
function renderBlocks(body) {
  const blocks = body.trim().split(/\n{2,}/);
  return blocks.map((block, i) => {
    const lines = block.split("\n");
    if (block.startsWith("## ")) return <h2 key={i}>{block.slice(3)}</h2>;
    if (block === "---") return <hr key={i} />;
    if (lines.every((l) => l.startsWith("- "))) {
      return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.slice(2))}</li>)}</ul>;
    }
    if (lines.length >= 2 && lines[0].startsWith("|") && /^\|[\s|:-]+\|$/.test(lines[1])) {
      const [head, , ...rows] = lines;
      return (
        <div className="legal-table-wrap" key={i}>
          <table className="legal-table">
            <thead><tr>{cells(head).map((c, j) => <th key={j}>{c}</th>)}</tr></thead>
            <tbody>{rows.map((r, j) => <tr key={j}>{cells(r).map((c, k) => <td key={k}>{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
    }
    return <p key={i}>{inline(lines.join(" "))}</p>;
  });
}

const { meta, body } = parseFrontMatter(source);
const [titleLine, subtitle, ...rest] = body.trim().split(/\n{2,}/);
const title = titleLine.replace(/^# /, "");

export default function DataProtectionPage({ onGoLanding }) {
  return (
    <div className="landing-root legal-root" dir="rtl" lang="ar">
      <header className="landing-nav">
        <a href="/" onClick={(e) => { e.preventDefault(); onGoLanding(); }}>
          <img src="/brand/athar-logo-horizontal.png" alt="أثر المحاسبي" className="landing-logo" />
        </a>
        <button className="btn-ghost" onClick={onGoLanding}>العودة للرئيسية</button>
      </header>

      <article className="legal-card">
        <h1>{title}</h1>
        <p className="legal-subtitle">{subtitle}</p>
        <div className="legal-meta">
          <span>الإصدار <strong data-testid="legal-version">{meta.version}</strong></span>
          <span className="legal-meta-sep" aria-hidden="true">·</span>
          <span>آخر تحديث <time dateTime={meta.lastUpdated} dir="ltr" data-testid="legal-last-updated">{meta.lastUpdated}</time></span>
        </div>
        {renderBlocks(rest.join("\n\n"))}
      </article>
    </div>
  );
}
