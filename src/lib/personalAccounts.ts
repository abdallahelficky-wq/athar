import type { Account } from "@prisma/client";
import { prisma } from "./prisma";
import { forbidden } from "./httpError";

/**
 * مجموعات حسابات الأشخاص (Account.isPersonalGroup): «ذمم الموظفين» وأي مجموعة أبناؤها حسابات بأسماء أفراد
 * (مثل سلف كل موظف باسمه). قرار المالك (2026-09-28): لغير أدوار الموارد البشرية تُعرَض المجموعة رصيداً
 * واحداً بلا تفصيل لكل شخص — في ميزان المراجعة وشجرة الحسابات والأستاذ والقوائم — طيّاً لا إخفاءً: رصيد
 * المجموعة مجموع أبنائها فيبقى كل تقرير متوازناً. دائم، لا مؤقت. القيد نفسه (السلفة مثلاً) يبقى باسم صاحبه
 * حيث رُحِّل؛ الذي يُطوى هو الرصيد المتراكم لكل شخص.
 *
 * الطيّ: كل حساب تحت مجموعة شخصية (بأي عمق) يُنسَب لأعلى مجموعة شخصية فوقه، وتُعامَل المجموعة في التقرير
 * كحساب ترحيل واحد يحمل مجموع أبنائها.
 */
export type PersonalFold = Map<string, Account>;

/** من قائمة حسابات محمَّلة أصلاً (التقارير تحمّل شجرة الشركة كاملة) */
export function personalFoldFromAccounts(accounts: Account[]): PersonalFold {
  const fold: PersonalFold = new Map();
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const byParent = new Map<string, Account[]>();
  accounts.forEach((a) => {
    if (a.parentId) byParent.set(a.parentId, [...(byParent.get(a.parentId) || []), a]);
  });
  const hasPersonalAncestor = (a: Account) => {
    let cur = a.parentId ? byId.get(a.parentId) : undefined;
    while (cur) {
      if (cur.isPersonalGroup) return true;
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return false;
  };
  const walk = (group: Account, parentId: string) => {
    for (const child of byParent.get(parentId) || []) {
      fold.set(child.id, group);
      walk(group, child.id);
    }
  };
  accounts.filter((a) => a.isPersonalGroup && !hasPersonalAncestor(a)).forEach((g) => walk(g, g.id));
  return fold;
}

/** للقراءات التي لا تحمّل الشجرة كاملة (القيود، الأستاذ، الداشبورد) */
export async function loadPersonalFold(tenantId: string, companyId?: string): Promise<PersonalFold> {
  const groups = await prisma.account.findMany({ where: { tenantId, companyId: companyId || undefined, isPersonalGroup: true } });
  if (!groups.length) return new Map();
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const parentOf = new Map<string, string>();
  let frontier = groups.map((g) => g.id);
  while (frontier.length) {
    const children = await prisma.account.findMany({ where: { tenantId, parentId: { in: frontier } }, select: { id: true, parentId: true } });
    const fresh = children.filter((c) => !parentOf.has(c.id));
    fresh.forEach((c) => parentOf.set(c.id, c.parentId!));
    frontier = fresh.map((c) => c.id);
  }
  const fold: PersonalFold = new Map();
  for (const id of parentOf.keys()) {
    let top: string | null = null;
    let cur: string | undefined = id;
    while (cur && parentOf.has(cur)) {
      cur = parentOf.get(cur);
      if (cur && groupById.has(cur)) top = cur;
    }
    if (top) fold.set(id, groupById.get(top)!);
  }
  return fold;
}

/** قائمة الحسابات بعد الطيّ: أبناء المجموعات الشخصية تُحذَف، والمجموعة نفسها تصير "حساب ترحيل" يحمل مجموعهم */
export function foldAccountList(accounts: Account[], fold: PersonalFold): Account[] {
  if (!fold.size) return accounts;
  const groupIds = new Set([...fold.values()].map((g) => g.id));
  return accounts.filter((a) => !fold.has(a.id)).map((a) => (groupIds.has(a.id) ? { ...a, isPosting: true } : a));
}

/** قيم حسابات الترحيل بعد الطيّ: قيمة كل ابن تُضاف لمجموعته، حقلاً بحقل */
export function foldValueMap<V extends Record<string, number>>(values: Map<string, V>, fold: PersonalFold): Map<string, V> {
  if (!fold.size) return values;
  const out = new Map<string, V>();
  for (const [id, value] of values) {
    const key = fold.get(id)?.id ?? id;
    const existing = out.get(key);
    if (!existing) {
      out.set(key, { ...value });
      continue;
    }
    const merged = { ...existing } as Record<string, number>;
    for (const field of Object.keys(value)) merged[field] = (merged[field] ?? 0) + value[field];
    out.set(key, merged as V);
  }
  return out;
}

/** هل الحساب ابن (بأي عمق) لمجموعة شخصية؟ المجموعة نفسها ليست ابناً. */
export async function isInsidePersonalGroup(tenantId: string, accountId: string): Promise<boolean> {
  let current = await prisma.account.findFirst({ where: { id: accountId, tenantId }, select: { parentId: true } });
  while (current?.parentId) {
    const parent: { parentId: string | null; isPersonalGroup: boolean } | null = await prisma.account.findFirst({
      where: { id: current.parentId, tenantId },
      select: { parentId: true, isPersonalGroup: true },
    });
    if (!parent) return false;
    if (parent.isPersonalGroup) return true;
    current = parent;
  }
  return false;
}

export const PERSONAL_ACCOUNT_FORBIDDEN = "هذا حساب شخص ضمن مجموعة تُعرَض رصيداً واحداً — التفصيل لكل شخص لأدوار الموارد البشرية فقط";

/** لغير أدوار الموارد البشرية: لا كشف ولا فلترة ولا ملخّص على حساب شخص بعينه — المجموعة فقط */
export async function assertNotPersonalAccount(hrView: boolean, tenantId: string, accountId: string | undefined) {
  if (hrView || !accountId) return;
  if (await isInsidePersonalGroup(tenantId, accountId)) throw forbidden(PERSONAL_ACCOUNT_FORBIDDEN);
}
