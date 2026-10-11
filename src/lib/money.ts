/**
 * قاعدة التقريب الوحيدة للمبالغ: خانتان عشريتان، نصف للأعلى (بعيداً عن الصفر) — نفس ما يفعله Postgres عند تخزين
 * رقم في عمود Decimal(18, 2)، ونفس ما تفترضه قواعد زاتكا (BR-CO-15، BR-KSA-51، BR-KSA-EN16931-11).
 *
 * لماذا ليس Math.round(n * 100) / 100: الضرب في الفاصلة العائمة يُفسد الحدّ — 219.775 مخزّنة ثنائياً 219.77499999999998،
 * فـMath.round(21977.499999999996) = 21977 ⇒ 219.77، بينما Postgres يستلم النص "219.775" ويقرّبه 219.78. هنا نقرّب التمثيل
 * العشري الأقصر للرقم (String(n)، وهو ما يُرسَل لقاعدة البيانات) بحساب صحيح على الهللات، فيتطابق ما نحسبه مع ما يُخزَّن.
 */
export function toHalalas(n: number): number {
  if (!Number.isFinite(n)) throw new Error(`مبلغ غير صالح: ${n}`);
  const negative = n < 0;
  let s = Math.abs(n).toString();
  if (s.includes("e")) s = Math.abs(n).toFixed(20);
  const [intPart, fracPart = ""] = s.split(".");
  const frac = (fracPart + "000").slice(0, 3);
  let halalas = Number(intPart) * 100 + Number(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) halalas += 1;
  return negative ? -halalas : halalas;
}

export function fromHalalas(h: number): number {
  return h / 100;
}

/**
 * round(h × num / den) بحساب صحيح، نصف للأعلى (بعيداً عن الصفر) — للضريبة: 191.30 × 15% = 28.695 ⇒ 28.70 بالضبط، بينما
 * 191.3 * 0.15 في الفاصلة العائمة = 28.694999999999997 ⇒ 28.69. h وnum وden أعداد صحيحة.
 */
export function mulDivHalfUp(h: number, num: number, den: number): number {
  const p = BigInt(h) * BigInt(num);
  const d = BigInt(den);
  const sign = p < 0n ? -1n : 1n;
  const abs = p < 0n ? -p : p;
  return Number(sign * ((abs * 2n + d) / (2n * d)));
}

/** نسبة الضريبة بالمئة (15) كعدد صحيح بأجزاء العشرة آلاف من الأساس: 15% ⇒ 1500/10000 */
export function vatOnNetHalalas(netHalalas: number, ratePercent: number): number {
  return mulDivHalfUp(netHalalas, Math.round(ratePercent * 100), 10000);
}

/** الضريبة المتضمَّنة في مبلغ شامل: total × rate / (100 + rate) */
export function vatInGrossHalalas(grossHalalas: number, ratePercent: number): number {
  const r = Math.round(ratePercent * 100);
  return mulDivHalfUp(grossHalalas, r, 10000 + r);
}

/** تقريب مبلغ لخانتين عشريتين، نصف للأعلى */
export function roundMoney(n: number): number {
  return fromHalalas(toHalalas(n));
}

/** جمع مبالغ بالهللات (أعداد صحيحة) — لا تراكم لأخطاء الفاصلة العائمة مهما كثرت الأسطر */
export function sumMoney(values: number[]): number {
  return fromHalalas(values.reduce((s, v) => s + toHalalas(v), 0));
}

/** تنسيق مبلغ بخانتين عشريتين بعد تقريبه بالقاعدة نفسها (لا قصّ) */
export function formatMoney(n: number): string {
  const h = toHalalas(n);
  const sign = h < 0 ? "-" : "";
  const abs = Math.abs(h);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
