import type { Prisma } from "@prisma/client";

/**
 * القيود التي تحتسبها الأرصدة: المرحَّلة دائماً، والمحفوظة فقط في شركة لم يُفعَّل فيها بعدُ مفتاح
 * "الأرصدة تحتسب المرحَّل فقط" (Company.balancesPostedOnly = false — شركة فيها قيود محفوظة سابقة لم
 * يراجعها مالكها بعد). كل قارئ أرصدة (ميزان المراجعة، الأستاذ، القوائم، الداشبورد، كشوف الأطراف،
 * أرصدة شجرة الحسابات) يُضيف هذا الشرط عبر AND حتى لا يتعارض مع أي OR آخر في استعلامه.
 */
export const COUNTED_ENTRY_WHERE: Prisma.JournalEntryWhereInput = {
  OR: [{ status: "posted" }, { company: { balancesPostedOnly: false } }],
};

/** القيود المحفوظة التي لا تحتسبها الأرصدة — ما يُعرَض في سطر "قيود محفوظة غير محتسبة". */
export const UNCOUNTED_DRAFT_WHERE: Prisma.JournalEntryWhereInput = {
  status: "saved",
  company: { balancesPostedOnly: true },
};
