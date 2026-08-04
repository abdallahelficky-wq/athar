import type { Account } from "@prisma/client";

/**
 * منطق تجميع مشترك لكل التقارير المالية (ميزان المراجعة، قائمة الدخل، المركز المالي، وأي تقرير
 * مالي مستقبلي): يحوّل قيماً محسوبة على مستوى حسابات الترحيل (المستوى الرابع فقط، وهي الوحيدة
 * التي تُرحَّل عليها القيود فعلياً) إلى صفوف مجمَّعة حسب مستوى مختار من شجرة الحسابات (1-4)، أو
 * حسب فرع/حساب معيّن يختاره المستخدم مع تبديل "بالتفاصيل/بدون تفاصيل".
 *
 * القاعدة: لو تم تحديد accountId معيّن (فرع أو حساب) — "بدون تفاصيل" يُنتج سطراً واحداً مجمَّعاً
 * لكل الفرع، و"بالتفاصيل" يُنتج سطراً منفصلاً لكل حساب ترحيل تحته (تفصيل كامل بصرف النظر عن قيمة
 * `level` المختارة، لأن مستوى الفرع نفسه يحدّد بالفعل نطاق الاستعلام). لو لم يُحدَّد accountId
 * إطلاقاً، يُجمَّع كل حساب ترحيل إلى أقرب سلف له عند المستوى المطلوب.
 */

export interface RollupOptions {
  level?: number; // 1-4، الافتراضي 4 (بلا أي تجميع، كل حساب ترحيل في سطر مستقل)
  accountId?: string | null; // تقييد النطاق لفرع/حساب معيّن (وكل ما تحته)
  includeDetails?: boolean; // فقط عندما accountId محدَّد: true = تفصيل كامل، false = سطر واحد مجمَّع
}

export interface RollupRow<V> {
  account: Account;
  value: V;
}

function ancestorChain(byId: Map<string, Account>, account: Account): Account[] {
  const chain: Account[] = [];
  let current: Account | undefined = account;
  while (current) {
    chain.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain;
}

/**
 * يجمّع خريطة قيم (مفتاحها معرّف حساب ترحيل) إلى صفوف حسب خيارات التجميع أعلاه. V هو أي نوع كائن
 * حقوله كلها أرقام قابلة للجمع (مثل {debit, credit} أو {amount}) — القيم تُجمع حقلاً بحقل.
 */
export function rollupAccountValues<V extends Record<string, number>>(
  accounts: Account[],
  values: Map<string, V>,
  emptyValue: V,
  options: RollupOptions,
): RollupRow<V>[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const level = options.level && options.level >= 1 && options.level <= 4 ? options.level : 4;

  const groupKeyFor = (postingId: string): string | null => {
    const chain = ancestorChain(byId, byId.get(postingId)!);
    if (options.accountId) {
      const inScope = chain.some((a) => a.id === options.accountId);
      if (!inScope) return null;
      return options.includeDetails ? postingId : options.accountId;
    }
    const ancestorAtLevel = chain.find((a) => a.level <= level) || chain[chain.length - 1];
    return ancestorAtLevel.id;
  };

  const groups = new Map<string, V>();
  for (const [postingId, value] of values.entries()) {
    if (!byId.has(postingId)) continue;
    const key = groupKeyFor(postingId);
    if (!key) continue;
    const existing = groups.get(key) ?? emptyValue;
    const merged = { ...existing } as V;
    for (const field of Object.keys(value)) {
      (merged as Record<string, number>)[field] = (existing[field] ?? 0) + value[field];
    }
    groups.set(key, merged);
  }

  return [...groups.entries()]
    .map(([accountId, value]) => ({ account: byId.get(accountId)!, value }))
    .filter((row): row is RollupRow<V> => Boolean(row.account))
    .sort((a, b) => a.account.code.localeCompare(b.account.code));
}
