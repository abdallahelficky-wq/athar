/**
 * تحويل كشف بنك (مصفوفة صفوف من Excel/CSV عبر XLSX.sheet_to_json({header:1})) إلى أسطر كشف للخادم.
 * كل بنك يصدّر أعمدة مختلفة، فالمستخدم يختار مرة: صف العناوين، وعمود التاريخ والبيان والمرجع، والمبلغ إما
 * عمودين (مدين/سحب + دائن/إيداع) أو عموداً واحداً موقَّعاً. القيم الشائعة في كشوف البنوك السعودية مدعومة:
 * تواريخ Excel الرقمية، dd/mm/yyyy وyyyy-mm-dd، أرقام بفواصل آلاف وأرقام عربية-هندية، والسالب بين قوسين.
 */

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export function normalizeDigits(value) {
  return String(value ?? "")
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)))
    .replace(/٫/g, ".")
    .replace(/٬/g, ",");
}

/** مبلغ من خلية: 1,234.50 / (250.00) / -250 / "SAR 1,000" / فارغ ⇒ 0 */
export function parseAmount(cell) {
  if (cell === null || cell === undefined || cell === "") return 0;
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : NaN;
  let s = normalizeDigits(cell).trim();
  if (!s) return 0;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (/-\s*$/.test(s)) { negative = true; s = s.replace(/-\s*$/, ""); }
  s = s.replace(/[^\d.,-]/g, "").replace(/,/g, "");
  if (s.startsWith("-")) { negative = !negative; s = s.slice(1); }
  if (!s) return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return negative ? -n : n;
}

const pad = (n) => String(n).padStart(2, "0");

/** تاريخ من خلية ⇒ "YYYY-MM-DD" أو null. رقم = تسلسل Excel؛ النص: yyyy-mm-dd أو dd/mm/yyyy أو dd-mm-yyyy. */
export function parseDate(cell) {
  if (cell === null || cell === undefined || cell === "") return null;
  if (cell instanceof Date && !Number.isNaN(cell.getTime())) {
    return `${cell.getFullYear()}-${pad(cell.getMonth() + 1)}-${pad(cell.getDate())}`;
  }
  if (typeof cell === "number") {
    if (cell < 20000 || cell > 80000) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(cell) * 86400000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = normalizeDigits(cell).trim().split(/[ T]/)[0];
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return valid(+m[3], +m[2], +m[1]);
  return null;
}

function valid(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** صف العناوين المقترَح: أكثر صف (في أول 40) تتعرّف خلاياه كعناوين أعمدة (تاريخ/بيان/مدين…)؛ وبلا أي تطابق: الصف
 * السابق لأول صف فيه تاريخ. المستخدم يراجعه في الشاشة. */
export function guessHeaderRow(matrix) {
  let best = -1;
  let bestScore = 1;
  for (let i = 0; i < Math.min(matrix.length, 40); i++) {
    const score = Object.keys(guessColumns(matrix[i])).length;
    if (score > bestScore) { best = i; bestScore = score; }
  }
  if (best >= 0) return best;
  for (let i = 0; i < Math.min(matrix.length, 40); i++) {
    if ((matrix[i] || []).some((c) => parseDate(c))) return Math.max(0, i - 1);
  }
  return 0;
}

const HINTS = {
  date: [/date/i, /تاريخ/],
  description: [/desc/i, /narrat/i, /details/i, /بيان/, /وصف/, /تفاصيل/],
  reference: [/ref/i, /مرجع/, /رقم العملية/],
  debit: [/debit/i, /withdraw/i, /مدين/, /سحب/, /مسحوب/],
  credit: [/credit/i, /deposit/i, /دائن/, /إيداع/, /ايداع/, /مودع/],
  amount: [/^amount$/i, /^المبلغ$/],
  balance: [/balance/i, /رصيد/],
};

/** اقتراح أعمدة من صف العناوين — المستخدم يراجعها في الشاشة */
export function guessColumns(headerRow) {
  const cols = {};
  (headerRow || []).forEach((h, i) => {
    const text = String(h ?? "");
    for (const [key, patterns] of Object.entries(HINTS)) {
      if (cols[key] === undefined && patterns.some((p) => p.test(text))) { cols[key] = i; break; }
    }
  });
  return cols;
}

/**
 * mapping: { headerRow, date, description?, reference?, debit?, credit?, amount?, amountSign: "depositPositive"|"withdrawalPositive" }
 * debit = عمود المسحوب (يُطرَح)، credit = عمود المودَع (يُضاف) — بمنظور كشف البنك للعميل.
 * يُرجع { lines, skipped, errors } — الصفوف بلا تاريخ أو بلا مبلغ (عناوين فرعية، أرصدة مرحَّلة، مجاميع) تُتخطّى.
 */
export function buildStatementLines(matrix, mapping) {
  const lines = [];
  const errors = [];
  let skipped = 0;
  for (let r = mapping.headerRow + 1; r < matrix.length; r++) {
    const row = matrix[r] || [];
    const date = parseDate(row[mapping.date]);
    let amount;
    if (mapping.amount !== undefined && mapping.amount !== "" && mapping.amount !== null) {
      amount = parseAmount(row[mapping.amount]);
      if (mapping.amountSign === "withdrawalPositive") amount = -amount;
    } else {
      const out = parseAmount(row[mapping.debit]);
      const inn = parseAmount(row[mapping.credit]);
      amount = (Number.isNaN(inn) || Number.isNaN(out)) ? NaN : Math.abs(inn) - Math.abs(out);
    }
    if (!date) { skipped++; continue; }
    if (Number.isNaN(amount)) { errors.push({ row: r + 1, reason: "amount" }); continue; }
    if (Math.round(amount * 100) === 0) { skipped++; continue; }
    lines.push({
      date,
      description: mapping.description !== undefined ? String(row[mapping.description] ?? "").trim() || null : null,
      reference: mapping.reference !== undefined ? String(row[mapping.reference] ?? "").trim() || null : null,
      amount: Math.round(amount * 100) / 100,
    });
  }
  return { lines, skipped, errors };
}

export function summarizeLines(lines) {
  if (!lines.length) return { periodStart: "", periodEnd: "", movement: 0 };
  const dates = lines.map((l) => l.date).sort();
  const movement = Math.round(lines.reduce((s, l) => s + Math.round(l.amount * 100), 0)) / 100;
  return { periodStart: dates[0], periodEnd: dates[dates.length - 1], movement };
}
