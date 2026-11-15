// تفقيط المبلغ (عربي/إنجليزي) لإشعار الراتب وإقرار الاستلام. الأساس: ريال سعودي وهللة.
const AR_UNITS = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة", "عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"];
const AR_TENS = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
const AR_HUNDREDS = ["", "مائة", "مائتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"];

function arBelowThousand(n) {
  const parts = [];
  const h = Math.floor(n / 100), r = n % 100;
  if (h) parts.push(AR_HUNDREDS[h]);
  if (r) {
    if (r < 20) parts.push(AR_UNITS[r]);
    else { const u = r % 10, t = Math.floor(r / 10); parts.push(u ? `${AR_UNITS[u]} و${AR_TENS[t]}` : AR_TENS[t]); }
  }
  return parts.join(" و");
}

// نطق عدد المجموعة (ألف/مليون) بحسب العدد: 1 مفرد، 2 مثنى، 3-10 جمع، 11+ مفرد منصوب
function arScaled(n, singular, dual, plural) {
  if (n === 1) return singular;
  if (n === 2) return dual;
  if (n >= 3 && n <= 10) return `${arBelowThousand(n)} ${plural}`;
  return `${arBelowThousand(n)} ${singular}`;
}

function arInteger(n) {
  if (n === 0) return "صفر";
  const millions = Math.floor(n / 1_000_000), thousands = Math.floor((n % 1_000_000) / 1000), rest = n % 1000;
  const parts = [];
  if (millions) parts.push(arScaled(millions, "مليون", "مليونان", "ملايين"));
  if (thousands) parts.push(arScaled(thousands, "ألف", "ألفان", "آلاف"));
  if (rest) parts.push(arBelowThousand(rest));
  return parts.join(" و");
}

const EN_UNITS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const EN_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
function enBelowThousand(n) {
  const parts = [];
  if (n >= 100) { parts.push(`${EN_UNITS[Math.floor(n / 100)]} hundred`); n %= 100; }
  if (n >= 20) parts.push(n % 10 ? `${EN_TENS[Math.floor(n / 10)]}-${EN_UNITS[n % 10]}` : EN_TENS[Math.floor(n / 10)]);
  else if (n) parts.push(EN_UNITS[n]);
  return parts.join(" ");
}
function enInteger(n) {
  if (n === 0) return "zero";
  const millions = Math.floor(n / 1_000_000), thousands = Math.floor((n % 1_000_000) / 1000), rest = n % 1000;
  const parts = [];
  if (millions) parts.push(`${enBelowThousand(millions)} million`);
  if (thousands) parts.push(`${enBelowThousand(thousands)} thousand`);
  if (rest) parts.push(enBelowThousand(rest));
  return parts.join(" ");
}

/** يفقّط مبلغاً بالريال السعودي. lang: "ar" | "en". يُرجع "" لقيمة غير صالحة أو أكبر من مليار. */
export function amountInWords(amount, lang = "ar") {
  const value = Math.abs(Number(amount));
  if (!Number.isFinite(value) || value >= 1_000_000_000) return "";
  const totalHalalas = Math.round(value * 100);
  const riyals = Math.floor(totalHalalas / 100), halalas = totalHalalas % 100;
  if (lang === "en") {
    const base = `${enInteger(riyals)} Saudi riyal${riyals === 1 ? "" : "s"}`;
    const text = halalas ? `${base} and ${enInteger(halalas)} halala${halalas === 1 ? "" : "s"}` : base;
    return `${text.charAt(0).toUpperCase()}${text.slice(1)} only`;
  }
  const base = `${arInteger(riyals)} ريال سعودي`;
  return `${halalas ? `${base} و${arInteger(halalas)} هللة` : base} فقط لا غير`;
}
