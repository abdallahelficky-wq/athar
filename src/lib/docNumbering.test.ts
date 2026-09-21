import { describe, expect, it, vi } from "vitest";
import { reserveDocumentNumber } from "./docNumbering";

// CHECK 2 (مراجعة PR #76): إشعارات المدين تحوّلت من formatDocNumber("DBN", count) (عدّاد تعداد
// بسيط) إلى reserveDocumentNumber (عدّاد ذرّي في document_numbering_settings) — يجب أن يبدأ أول
// رقم صادر لشركة لديها إشعارات مدين موجودة فعلاً أكبر بمقدار 1 من أعلى رقم موجود، لا من 1 (وإلا
// تصادم فوري مع "DBN-00001" الموجودة بالفعل). migration.sql المرافقة
// (20260921120000_sales_debit_note_numbering_scope) تُهيِّئ nextSeq مسبقاً بالضبط لهذا السبب —
// تحقّق منطق حساب MAX+1 لكل شركة على حدة تم بشكل مباشر عبر psql (راجع تقرير المراجعة)، لأن هذا
// المشروع لا يُشغِّل اختبارات تكامل بقاعدة بيانات حقيقية (كل الاختبارات هنا Prisma مُموَّهة). هذا
// الاختبار يتحقق من الشطر الآخر من نفس الضمان: أن reserveDocumentNumber نفسها تحترم فعلياً أي
// nextSeq مُهيَّأ مسبقاً (كما تكتبه الهجرة)، لا تُعيد البدء من 1 مهما كان الصف موجوداً بالفعل.
describe("reserveDocumentNumber — debit note numbering continuity after the count-based → atomic-counter migration", () => {
  it("continues from a pre-seeded nextSeq (as the migration backfill sets for a company with 47 pre-existing debit notes) instead of restarting at 1", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    // يُحاكي بالضبط ما تكتبه migration.sql لشركة لديها DBN-00001..DBN-00047 موجودة فعلاً قبل
    // التحوّل: الصف مُهيَّأ مسبقاً بـnextSeq=48 (لا 1 الافتراضي) — أي الرقم التالي المتاح للحجز هو
    // 48. tx.$queryRaw هنا وهمية تُمثِّل نتيجة UPDATE...RETURNING الحقيقية (raw SQL لا يمكن تنفيذه
    // بلا Postgres فعلية)، فتُعيد "seq: 48" مباشرة كما يجب أن يُعيده الاستعلام الحقيقي في هذه الحالة.
    const queryRaw = vi.fn().mockResolvedValue([{ seq: 48, prefix: "DBN-", digits: 5 }]);
    const tx = { documentNumberingSettings: { upsert }, $queryRaw: queryRaw } as any;

    const result = await reserveDocumentNumber(tx, "tenant-1", "company-with-history", "sales_debit_note");

    expect(result).toBe("DBN-00048");
    // ملاحظة أساسية: القيمة 48 هنا أتت من tx.$queryRaw (تُحاكي عمود nextSeq المُهيَّأ من الهجرة) —
    // لا من upsert's create (الذي يعتمد على القيمة الافتراضية 1 فقط عند عدم وجود صف مُهيَّأ مسبقاً
    // أصلاً)؛ upsert's update: {} صراحة لا تكتب فوق nextSeq الموجود.
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: {} }),
    );
  });

  it("still starts at 1 for a brand-new company/docType pair with no pre-existing documents at all", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const queryRaw = vi.fn().mockResolvedValue([{ seq: 1, prefix: "DBN-", digits: 5 }]);
    const tx = { documentNumberingSettings: { upsert }, $queryRaw: queryRaw } as any;

    const result = await reserveDocumentNumber(tx, "tenant-1", "brand-new-company", "sales_debit_note");

    expect(result).toBe("DBN-00001");
  });

  it("never collides two different companies of the same tenant on the same number, since each is seeded from its own history", async () => {
    // شركة A بتاريخ حتى DBN-00047 → 48 التالي. شركة B بتاريخ حتى DBN-00003 فقط → 4 التالي. لكل
    // شركة صفّها الخاص في document_numbering_settings (نطاق العدّاد لكل شركة، لا للمستأجر بالكامل).
    const makeTx = (seededSeq: number) => ({
      documentNumberingSettings: { upsert: vi.fn().mockResolvedValue({}) },
      $queryRaw: vi.fn().mockResolvedValue([{ seq: seededSeq, prefix: "DBN-", digits: 5 }]),
    });

    const companyA = await reserveDocumentNumber(makeTx(48) as any, "tenant-1", "company-a", "sales_debit_note");
    const companyB = await reserveDocumentNumber(makeTx(4) as any, "tenant-1", "company-b", "sales_debit_note");

    expect(companyA).toBe("DBN-00048");
    expect(companyB).toBe("DBN-00004");
    expect(companyA).not.toBe(companyB);
  });
});
