import { describe, expect, it, vi } from "vitest";
import { generateNextCode, LEVEL_CODE_LENGTH } from "./accountCodes";

/** عميل Prisma مموَّه بأقل ما يلزم: account.findFirst (لجلب الأب) وaccount.findMany (لمسح مساحة
 * الكود) — كافٍ لاختبار منطق generateNextCode بمعزل عن قاعدة بيانات حقيقية. */
function fakeClient(accounts: Array<{ id: string; code: string; level: number; isPosting: boolean }>) {
  return {
    account: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
        accounts.find((a) => a.id === where.id) ?? null,
      ),
      findMany: vi.fn(async ({ where }: { where: { code: { startsWith: string } } }) =>
        accounts
          .filter((a) => a.code.startsWith(where.code.startsWith))
          .map((a) => ({ code: a.code })),
      ),
    },
  } as unknown as Parameters<typeof generateNextCode>[0];
}

describe("generateNextCode", () => {
  it("gives the first suffix under an empty parent", async () => {
    const client = fakeClient([{ id: "p", code: "112", level: 3, isPosting: false }]);
    const code = await generateNextCode(client, "t1", "c1", "p");
    expect(code).toBe("112001");
  });

  it("continues after the highest suffix among direct siblings", async () => {
    const client = fakeClient([
      { id: "p", code: "112", level: 3, isPosting: false },
      { id: "c1", code: "112001", level: 4, isPosting: true },
      { id: "c2", code: "112002", level: 4, isPosting: true },
    ]);
    const code = await generateNextCode(client, "t1", "c1", "p");
    expect(code).toBe("112003");
  });

  // انحدار مباشر عن حادثة حقيقية: بعد فصل الحسابات القياسية عن "112" إلى مجموعة شقيقة جديدة
  // ("117"، migration party_subledger_grouping)، "112" يصبح بلا أبناء مباشرين مؤقتاً بينما أكواد
  // "112001"–"112005" لا تزال موجودة فعلياً في الشركة (تحت 117 الآن) — إن حسبت هذه الدالة اللاحقة
  // التالية من الإخوة المباشرين لـ"112" فقط، ستُعيد "112001" رغم استخدامه فعلياً، فيفشل إنشاء أول
  // عميل جديد بخطأ تكرار الكود. يجب أن تُحسَب اللاحقة من كل حساب في الشركة كوده يبدأ بـ"112"
  // وبنفس طول المستوى المستهدف، بصرف النظر عن أبيه الحالي.
  it("skips codes already used elsewhere in the company, even when the parent itself currently has no children (e.g. after its accounts were re-parented to a sibling group)", async () => {
    const client = fakeClient([
      { id: "p11", code: "11", level: 2, isPosting: false },
      { id: "p112", code: "112", level: 3, isPosting: false }, // now empty — no account has parentId "p112" any more
      { id: "p117", code: "117", level: 3, isPosting: false },
      { id: "c1", code: "112001", level: 4, isPosting: true }, // lives under p117 now, but generateNextCode never looks at parentId
      { id: "c2", code: "112002", level: 4, isPosting: true },
      { id: "c3", code: "112003", level: 4, isPosting: true },
      { id: "c4", code: "112004", level: 4, isPosting: true },
      { id: "c5", code: "112005", level: 4, isPosting: true },
    ]);
    const code = await generateNextCode(client, "t1", "c1", "p112");
    expect(code).toBe("112006");
  });

  it("does not confuse a shorter or longer code sharing the same prefix with a same-length sibling", async () => {
    const client = fakeClient([
      { id: "p11", code: "11", level: 2, isPosting: false },
      { id: "p112", code: "112", level: 3, isPosting: false },
      // "1120010" (7 digits) must never be read as suffix "0010" for a 6-digit level-4 code.
      { id: "long", code: "1120010", level: 4, isPosting: true },
    ]);
    const code = await generateNextCode(client, "t1", "c1", "p112");
    expect(code).toBe("112001");
  });

  it("rejects a posting (leaf) parent", async () => {
    const client = fakeClient([{ id: "p", code: "112001", level: 4, isPosting: true }]);
    await expect(generateNextCode(client, "t1", "c1", "p")).rejects.toThrow();
  });

  it("matches LEVEL_CODE_LENGTH's target width for the generated code", async () => {
    const client = fakeClient([{ id: "p", code: "1", level: 1, isPosting: false }]);
    const code = await generateNextCode(client, "t1", "c1", "p");
    expect(code).toHaveLength(LEVEL_CODE_LENGTH[2]);
  });
});
