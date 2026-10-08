import { describe, expect, it } from "vitest";
import { buildKeysetWhere, KeysetLevel, SortDir } from "./keysetPagination";

// مُقيِّم صغير لمجموعة العمليات التي يُنتجها buildKeysetWhere بالضبط (OR/AND/lt/gt/مساواة مباشرة/
// null) — يكفي لتشغيل الشرط الناتج على بيانات في الذاكرة دون أي اتصال بقاعدة بيانات، ليُثبِت صحة
// الخوارزمية نفسها (لا تكامل Prisma/SQL، وهو خارج نطاق هذا الاختبار بلا قاعدة بيانات فعلية).
function evaluate(where: Record<string, unknown>, row: Record<string, unknown>): boolean {
  if (Object.keys(where).length === 0) return true;
  if ("OR" in where) return (where.OR as Record<string, unknown>[]).some((branch) => evaluate(branch, row));
  if ("AND" in where) return (where.AND as Record<string, unknown>[]).every((branch) => evaluate(branch, row));

  return Object.entries(where).every(([field, condition]) => {
    const rowValue = row[field];
    if (condition === null) return rowValue === null;
    if (typeof condition === "object" && condition !== null) {
      const c = condition as { lt?: unknown; gt?: unknown };
      if ("lt" in c) return rowValue !== null && (rowValue as number) < (c.lt as number);
      if ("gt" in c) return rowValue !== null && (rowValue as number) > (c.gt as number);
    }
    return rowValue === condition;
  });
}

interface Row {
  id: string;
  date: number;
  entrySeq: number | null;
}

const DATE_ENTRYSEQ_ID: (dir: SortDir) => (row: Row) => KeysetLevel[] = (dir) => (cursor) => [
  { field: "date", dir, value: cursor.date, nullable: false },
  { field: "entrySeq", dir, value: cursor.entrySeq, nullable: true },
  { field: "id", dir, value: cursor.id, nullable: false },
];

/** نفس ترتيب SQL المطلوب بالضبط: date desc، entrySeq desc NULLS LAST، id desc كفاصل نهائي. */
function sortDesc(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => {
    if (a.date !== b.date) return b.date - a.date;
    if (a.entrySeq === null && b.entrySeq === null) return b.id.localeCompare(a.id);
    if (a.entrySeq === null) return 1; // null يذهب آخراً
    if (b.entrySeq === null) return -1;
    if (a.entrySeq !== b.entrySeq) return b.entrySeq - a.entrySeq;
    return b.id.localeCompare(a.id);
  });
}

/** يُحاكي صفحات متتالية بحجم pageSize عبر buildKeysetWhere فقط (بلا قاعدة بيانات)، ويُعيد كل العناصر المُجمَّعة بترتيب ظهورها. */
function paginateAll(rows: Row[], pageSize: number): Row[] {
  const sorted = sortDesc(rows);
  const collected: Row[] = [];
  let cursor: Row | null = null;

  for (let guard = 0; guard < 1000; guard += 1) {
    const where: Record<string, unknown> = cursor ? buildKeysetWhere(DATE_ENTRYSEQ_ID("desc")(cursor)) : {};
    const matching: Row[] = sorted.filter((r) => evaluate(where, r as unknown as Record<string, unknown>));
    const page: Row[] = matching.slice(0, pageSize);
    if (page.length === 0) break;
    collected.push(...page);
    cursor = page[page.length - 1];
    if (page.length < pageSize) break;
  }
  return collected;
}

describe("buildKeysetWhere", () => {
  it("يُرجِع شرطاً فارغاً (كل الصفوف) بلا مؤشر", () => {
    expect(buildKeysetWhere([])).toEqual({});
  });

  it("يتجاوز صفوف تاريخها أحدث، ويُدرج ما بعده بالتساوي عبر entrySeq/id", () => {
    const rows: Row[] = [
      { id: "a", date: 3, entrySeq: 1 },
      { id: "b", date: 2, entrySeq: 5 },
      { id: "c", date: 2, entrySeq: 3 },
      { id: "d", date: 1, entrySeq: 9 },
    ];
    const cursor: Row = { id: "b", date: 2, entrySeq: 5 };
    const where = buildKeysetWhere(DATE_ENTRYSEQ_ID("desc")(cursor));
    const after = rows.filter((r) => evaluate(where, r as unknown as Record<string, unknown>)).map((r) => r.id);
    expect(after.sort()).toEqual(["c", "d"]);
  });

  it("ترقيم صفحات كامل عبر حدّ صفحة بتواريخ متطابقة (نفس اليوم لعدّة قيود) — بلا تكرار أو فجوة", () => {
    // 7 قيود، 3 منها بنفس التاريخ (2) — حدّ الصفحة 2 يقع تماماً وسط هذه المجموعة المتطابقة.
    const rows: Row[] = [
      { id: "e1", date: 3, entrySeq: 10 },
      { id: "e2", date: 2, entrySeq: 30 },
      { id: "e3", date: 2, entrySeq: 20 },
      { id: "e4", date: 2, entrySeq: 10 },
      { id: "e5", date: 1, entrySeq: 40 },
      { id: "e6", date: 1, entrySeq: 20 },
      { id: "e7", date: 0, entrySeq: 5 },
    ];
    const result = paginateAll(rows, 2);
    expect(result.map((r) => r.id)).toEqual(["e1", "e2", "e3", "e4", "e5", "e6", "e7"]);
    // لا تكرار
    expect(new Set(result.map((r) => r.id)).size).toBe(rows.length);
  });

  it("entrySeq فارغ (NULL) يُعامَل كآخر الترتيب دائماً، وحدّ الصفحة يقع بين قيد بقيمة وقيد NULL بنفس التاريخ", () => {
    const rows: Row[] = [
      { id: "n1", date: 5, entrySeq: 2 },
      { id: "n2", date: 5, entrySeq: null }, // قيد قديم غير قابل للتفسير، نفس تاريخ n1
      { id: "n3", date: 5, entrySeq: null }, // قيد قديم آخر، نفس التاريخ، يُفصَل عن n2 بـid فقط
      { id: "n4", date: 4, entrySeq: 99 },
    ];
    const result = paginateAll(rows, 2);
    // الترتيب المتوقَّع: n1 (له قيمة) أولاً، ثم n3/n2 (NULL، مفصولة بـid تنازلياً: n3 > n2)، ثم n4.
    expect(result.map((r) => r.id)).toEqual(["n1", "n3", "n2", "n4"]);
  });

  it("مؤشر بقيمة entrySeq فارغة (NULL): الصفحة التالية تُرجِع فقط بقية القيود NULL بنفس التاريخ (بـid أصغر)، لا شيء آخر", () => {
    const rows: Row[] = [
      { id: "z1", date: 5, entrySeq: 2 },
      { id: "z2", date: 5, entrySeq: null },
      { id: "z3", date: 5, entrySeq: null },
    ];
    const cursorAtNull: Row = { id: "z3", date: 5, entrySeq: null };
    const where = buildKeysetWhere(DATE_ENTRYSEQ_ID("desc")(cursorAtNull));
    const after = rows.filter((r) => evaluate(where, r as unknown as Record<string, unknown>)).map((r) => r.id);
    // z1 له قيمة فعلية (غير NULL) — يجب ألا يظهر "بعد" مؤشر NULL (NULL هو آخر الترتيب بالفعل).
    expect(after).toEqual(["z2"]);
  });

  it("يعمل بنفس الصحة في الاتجاه التصاعدي (asc) — nulls تبقى آخر الترتيب دوماً", () => {
    const rows: Row[] = [
      { id: "p1", date: 1, entrySeq: 1 },
      { id: "p2", date: 1, entrySeq: 2 },
      { id: "p3", date: 1, entrySeq: null },
    ];
    const cursor: Row = { id: "p1", date: 1, entrySeq: 1 };
    const where = buildKeysetWhere(DATE_ENTRYSEQ_ID("asc")(cursor));
    const after = rows.filter((r) => evaluate(where, r as unknown as Record<string, unknown>)).map((r) => r.id).sort();
    // بعد entrySeq=1 تصاعدياً: entrySeq=2 (أكبر)، وNULL (يبقى آخراً مهما كان الاتجاه).
    expect(after).toEqual(["p2", "p3"]);
  });
});
