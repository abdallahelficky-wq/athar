/**
 * نموذج أثر الذكي — الجزء الحتمي (بلا نموذج لغوي): توقع سلاسل شهرية وكشف شذوذ إحصائي.
 * دوال نقية بلا قاعدة بيانات، فتُختبَر مباشرةً وتُغذّي النموذج اللغوي بأدلة محسوبة بدل أن يُخمّن الأرقام.
 */

export interface MonthPoint { month: string; value: number }

export interface ForecastPoint { month: string; value: number; low: number; high: number }
export interface ForecastResult {
  /** مستوى الثقة بحسب طول السلسلة: low < 4 أشهر فعلية، medium < 9، وإلا high */
  confidence: "low" | "medium" | "high";
  /** اتجاه الميل: نسبة التغيّر الشهري التقريبية إلى متوسط السلسلة */
  trendPct: number;
  points: ForecastPoint[];
}

export interface Anomaly {
  metric: string;
  month: string;
  value: number;
  expected: number;
  /** الانحراف المعدَّل (Modified Z-score) — موجب = أعلى من المعتاد */
  score: number;
  direction: "high" | "low";
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** يُسقِط الأشهر الصفرية في بداية السلسلة (قبل بدء النشاط) حتى لا تشوّه الاتجاه. */
export function trimLeadingZeros(series: MonthPoint[]): MonthPoint[] {
  const i = series.findIndex((p) => p.value !== 0);
  return i === -1 ? [] : series.slice(i);
}

/**
 * توقع خطي بانحدار OLS على السلسلة الفعلية مع تخميد الميل (0.8 لكل شهر مستقبلي) كي لا يُضخَّم اتجاه قصير،
 * ونطاق ±1.28·σ (≈80%) من بواقي الانحدار يتّسع مع الأفق. لا تُستخدَم أشهر الصفر السابقة لبدء النشاط.
 */
export function forecastSeries(series: MonthPoint[], horizon = 3): ForecastResult | null {
  const data = trimLeadingZeros(series);
  const n = data.length;
  if (n < 3) return null;
  const xs = data.map((_, i) => i);
  const ys = data.map((p) => p.value);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  const sxx = xs.reduce((a, x) => a + (x - meanX) ** 2, 0);
  const slope = sxx === 0 ? 0 : xs.reduce((a, x, i) => a + (x - meanX) * (ys[i] - meanY), 0) / sxx;
  const intercept = meanY - slope * meanX;
  const residuals = ys.map((y, i) => y - (intercept + slope * i));
  const sigma = Math.sqrt(residuals.reduce((a, e) => a + e * e, 0) / Math.max(1, n - 2));
  const last = data[n - 1];
  const lastFit = intercept + slope * (n - 1);
  const points: ForecastPoint[] = [];
  let cumulativeSlope = 0;
  for (let h = 1; h <= horizon; h++) {
    cumulativeSlope += slope * 0.8 ** h;
    const value = lastFit + cumulativeSlope;
    const band = 1.28 * sigma * Math.sqrt(1 + h / n);
    points.push({ month: addMonths(last.month, h), value: r2(value), low: r2(value - band), high: r2(value + band) });
  }
  const trendPct = meanY === 0 ? 0 : r2((slope / Math.abs(meanY)) * 100);
  return { confidence: n < 4 ? "low" : n < 9 ? "medium" : "high", trendPct, points };
}

/**
 * شذوذ بالـModified Z-score (متين أمام القيم المتطرفة لأنه يعتمد الوسيط وMAD لا المتوسط والانحراف المعياري).
 * الحد 3.5 هو الشائع (Iglewicz & Hoaglin). يتطلب 6 أشهر على الأقل بعد حذف أشهر ما قبل النشاط، ويتجاهل
 * الانحرافات الصغيرة بالقيمة المطلقة (أقل من 5% من الوسيط) حتى لا يُنبَّه على ضجيج.
 */
export function detectSeriesAnomalies(metric: string, series: MonthPoint[], threshold = 3.5): Anomaly[] {
  const data = trimLeadingZeros(series);
  if (data.length < 6) return [];
  const values = data.map((p) => p.value);
  const med = median(values);
  const mad = median(values.map((v) => Math.abs(v - med)));
  // MAD صفري (قيم متطابقة): ننتقل إلى متوسط الانحراف المطلق حتى لا نقسم على صفر.
  const meanAbsDev = values.reduce((a, v) => a + Math.abs(v - med), 0) / values.length;
  const out: Anomaly[] = [];
  for (const p of data) {
    const dev = p.value - med;
    if (Math.abs(dev) < Math.abs(med) * 0.05) continue;
    const score = mad > 0 ? (0.6745 * dev) / mad : meanAbsDev > 0 ? dev / (1.253314 * meanAbsDev) : 0;
    if (Math.abs(score) >= threshold) {
      out.push({ metric, month: p.month, value: r2(p.value), expected: r2(med), score: r2(score), direction: dev > 0 ? "high" : "low" });
    }
  }
  return out;
}

export interface DuplicateCandidate {
  entryIds: string[];
  entryNumbers: string[];
  date: string;
  total: number;
}

/** قيود يُشتبه بتكرارها: نفس الشركة والتاريخ والمجموع والبيان المطبَّع. تُرتَّب بالأكبر مبلغاً. لا يُخرَج البيان نفسه (قد يحمل أسماء) — أرقام القيود تكفي للمراجعة. */
export function findDuplicateEntries(entries: Array<{ id: string; entryNumber: string; companyId: string; date: Date; memo: string | null; total: number }>): DuplicateCandidate[] {
  const groups = new Map<string, typeof entries>();
  for (const e of entries) {
    if (!(e.total > 0)) continue;
    const key = [e.companyId, e.date.toISOString().slice(0, 10), r2(e.total), (e.memo ?? "").trim().toLowerCase()].join("|");
    const g = groups.get(key);
    if (g) g.push(e); else groups.set(key, [e]);
  }
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => ({
      entryIds: g.map((e) => e.id),
      entryNumbers: g.map((e) => e.entryNumber),
      date: g[0].date.toISOString().slice(0, 10),
      total: r2(g[0].total),
    }))
    .sort((a, b) => b.total - a.total);
}
