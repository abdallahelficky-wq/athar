import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { HttpError } from "../../lib/httpError";
import { buildKeysetWhere, KeysetLevel } from "../../lib/keysetPagination";
import {
  BALANCE_EPSILON,
  EXPORT_SAFETY_CAP,
  assertWithinExportCap,
  buildJournalEntriesCsv,
  buildJournalEntryWhere,
} from "./journalEntriesQuery";

// مُقيِّم صغير (نفس أسلوب keysetPagination.test.ts) يكفي لتشغيل شرط AND/OR/gte/lte/lt الناتج عن
// buildJournalEntryWhere وbuildKeysetWhere معاً على بيانات في الذاكرة — بلا أي اتصال بقاعدة بيانات.
function evaluate(where: Record<string, unknown>, row: Record<string, unknown>): boolean {
  if (Object.keys(where).length === 0) return true;
  if ("OR" in where) return (where.OR as Record<string, unknown>[]).some((b) => evaluate(b, row));
  if ("AND" in where) return (where.AND as Record<string, unknown>[]).every((b) => evaluate(b, row));

  return Object.entries(where).every(([field, condition]) => {
    if (field === "tenantId" || field === "companyId" || field === "status") {
      return condition === undefined || row[field] === condition;
    }
    const rowValue = row[field];
    if (condition === null) return rowValue === null;
    if (typeof condition === "object" && condition !== null) {
      const c = condition as { lt?: unknown; gt?: unknown; gte?: Prisma.Decimal; lte?: Prisma.Decimal };
      if ("lt" in c) return rowValue !== null && (rowValue as number) < (c.lt as number);
      if ("gt" in c) return rowValue !== null && (rowValue as number) > (c.gt as number);
      if ("gte" in c || "lte" in c) {
        const num = Number(rowValue);
        if (c.gte != null && num < Number(c.gte)) return false;
        if (c.lte != null && num > Number(c.lte)) return false;
        return true;
      }
    }
    return rowValue === condition;
  });
}

interface Row {
  id: string;
  date: number;
  totalDebit: number;
}

describe("buildJournalEntryWhere — فلتر المبلغ أصبح شرط SQL حقيقي", () => {
  it("amount: يبني مدى totalDebit بعرض BALANCE_EPSILON على الطرفين", () => {
    const where = buildJournalEntryWhere("t1", { amount: 500 });
    const andArr = where.AND as Array<{ totalDebit?: { gte: Prisma.Decimal; lte: Prisma.Decimal } }>;
    const amountCond = andArr.find((c) => c.totalDebit)!.totalDebit!;
    expect(Number(amountCond.gte)).toBeCloseTo(500 - BALANCE_EPSILON, 5);
    expect(Number(amountCond.lte)).toBeCloseTo(500 + BALANCE_EPSILON, 5);
  });

  it("amountMin/amountMax: يبنيان gte/lte مستقلّين", () => {
    const where = buildJournalEntryWhere("t1", { amountMin: 100, amountMax: 900 });
    const andArr = where.AND as Array<{ totalDebit?: { gte?: Prisma.Decimal; lte?: Prisma.Decimal } }>;
    const minCond = andArr.find((c) => c.totalDebit?.gte != null)!.totalDebit!;
    const maxCond = andArr.find((c) => c.totalDebit?.lte != null)!.totalDebit!;
    expect(Number(minCond.gte)).toBeCloseTo(100 - BALANCE_EPSILON, 5);
    expect(Number(maxCond.lte)).toBeCloseTo(900 + BALANCE_EPSILON, 5);
  });
});

describe("فلتر المبلغ مطبَّق قبل الترقيم (WHERE) — تظهر كل النتائج المطابقة حتى بعد الصفحة الأولى", () => {
  it("مجموعة بها تطابقات متفرّقة (1 من كل 3) وحدّ صفحة صغير — كل التطابقات تظهر عبر صفحات متعددة بلا فقدان", () => {
    // 12 قيداً، فقط ذوو totalDebit بين 490-510 يطابقون الفلتر (4 قيود، أرقام زوجية×3). حدّ الصفحة 2
    // يعني تطابقات هذا الفلتر تمتد لأكثر من "صفحة" واحدة من القيود المطابقة نفسها — تحديداً السيناريو
    // الذي كان يُكسَر سابقاً عندما كان الفلتر يُطبَّق في الذاكرة *بعد* تحديد صفحة من القيود الخام.
    const rows: Row[] = Array.from({ length: 12 }, (_, i) => ({
      id: `e${11 - i}`, // ids تنازلية لتطابق ترتيب id تنازلياً عند تساوي date
      date: 12 - i,
      totalDebit: i % 3 === 0 ? 500 : 1000 + i, // e11,e8,e5,e2 → date=12,9,6,3 تطابق الفلتر
    }));
    const matchingIds = rows.filter((r) => r.totalDebit >= 490 && r.totalDebit <= 510).map((r) => r.id);
    expect(matchingIds.length).toBe(4); // تأكيد افتراض السيناريو نفسه قبل اختبار الترقيم

    const where = buildJournalEntryWhere("t1", { amountMin: 490, amountMax: 510 });
    const pageSize = 2;
    const collected: Row[] = [];
    let cursor: Row | null = null;

    for (let guard = 0; guard < 100; guard += 1) {
      const levels: KeysetLevel[] = cursor
        ? [
            { field: "date", dir: "desc", value: cursor.date, nullable: false },
            { field: "id", dir: "desc", value: cursor.id, nullable: false },
          ]
        : [];
      const cursorWhere: Record<string, unknown> = cursor ? buildKeysetWhere(levels) : {};
      const matching = rows
        .filter((r) => evaluate(where as unknown as Record<string, unknown>, r as unknown as Record<string, unknown>))
        .filter((r) => evaluate(cursorWhere, r as unknown as Record<string, unknown>))
        .sort((a, b) => b.date - a.date || b.id.localeCompare(a.id));
      const page = matching.slice(0, pageSize);
      if (page.length === 0) break;
      collected.push(...page);
      cursor = page[page.length - 1];
      if (page.length < pageSize) break;
    }

    expect(collected.map((r) => r.id).sort()).toEqual([...matchingIds].sort());
    // صفحة واحدة (pageSize=2) لا تكفي لعرض كل الأربعة — تأكيد أن التجميع عبر "ما بعد الصفحة الأولى" ضروري هنا فعلاً.
    expect(collected.length).toBeGreaterThan(pageSize);
  });
});

describe("assertWithinExportCap — لا يُقطَع التصدير أبداً بصمت", () => {
  it("لا يرمي أي خطأ عندما العدد ضمن الحدّ", () => {
    expect(() => assertWithinExportCap(EXPORT_SAFETY_CAP)).not.toThrow();
    expect(() => assertWithinExportCap(1)).not.toThrow();
  });

  it("يرمي HttpError 400 واضحاً عند تجاوز الحدّ — لا يُرجِع نتيجة جزئية أبداً", () => {
    expect(() => assertWithinExportCap(EXPORT_SAFETY_CAP + 1)).toThrow(HttpError);
    try {
      assertWithinExportCap(50_000, 20_000);
      throw new Error("لم يُرمَ أي خطأ — غير متوقَّع");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(400);
      expect((err as HttpError).message).toContain("50000");
      expect((err as HttpError).message).toContain("20000");
    }
  });
});

describe("buildJournalEntriesCsv — التصدير يشمل كل الصفوف الممرَّرة بلا قطع", () => {
  it("يُنتج سطر عنوان واحد + سطر واحد بالضبط لكل صف، لكل الصفوف (لا حدّ صفحة هنا)", () => {
    const rowCount = 150; // أكبر من أي حدّ صفحة معقول (25/100) — يُثبت عدم الاعتماد على take
    const rows = Array.from({ length: rowCount }, (_, i) => ({
      entryNumber: `J${String(i + 1).padStart(5, "0")}`,
      date: new Date(2026, 0, (i % 28) + 1),
      memo: i % 2 === 0 ? `بيان ${i}` : null,
      status: i % 3 === 0 ? "posted" : "saved",
      totalDebit: new Prisma.Decimal((i + 1) * 10),
    }));

    const csv = buildJournalEntriesCsv(rows);
    const lines = csv.replace(/^﻿/, "").split("\r\n");

    expect(lines.length).toBe(rowCount + 1); // عنوان + كل الصفوف، بلا أي قطع
    expect(lines[0]).toBe('"رقم القيد","التاريخ","البيان","الحالة","الإجمالي"');
    // أول وآخر صف تحديداً — يُثبت أن الصفوف الأخيرة (ما بعد أي حدّ صفحة افتراضي) لم تُفقَد.
    expect(lines[1]).toContain(rows[0].entryNumber);
    expect(lines[rowCount]).toContain(rows[rowCount - 1].entryNumber);
    expect(lines[rowCount]).toContain(String(rowCount * 10));
  });

  it("يُترجم الحالة ويستبدل البيان الفارغ (null) بسلسلة فارغة بدل الكلمة null", () => {
    const csv = buildJournalEntriesCsv([
      { entryNumber: "J00001", date: new Date("2026-01-01"), memo: null, status: "posted", totalDebit: 100 },
    ]);
    const [, row] = csv.replace(/^﻿/, "").split("\r\n");
    expect(row).toBe('"J00001","2026-01-01","","مرحّل","100"');
  });
});
