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

export interface TreeNode<V> {
  account: Account;
  value: V; // إجمالي كل حسابات الترحيل تحت هذا الحساب (أو قيمته هو لو كان حساب ترحيل بذاته)
  children: TreeNode<V>[];
}

/**
 * يبني شجرة حسابات كاملة (من جذور المستوى الأول حتى أوراق المستوى الرابع) بحيث تحمل كل عقدة —
 * على أي مستوى — إجمالي كل حسابات الترحيل تحتها، محسوباً تصاعدياً من الأوراق. هذا هو الأساس
 * لعرض "ميزان المراجعة الهرمي": كل مجموعة (مستوى 1-3) هي سطر إجمالي تلقائي لكل ما تحتها، تماماً
 * كشجرة الحسابات نفسها في شاشة "شجرة الحسابات"، بدل مستوى واحد مسطّح مثل rollupAccountValues.
 */
export function buildAccountValueTree<V extends Record<string, number>>(
  accounts: Account[],
  postingValues: Map<string, V>,
  emptyValue: V,
): TreeNode<V>[] {
  const byParent = new Map<string | null, Account[]>();
  accounts.forEach((a) => byParent.set(a.parentId, [...(byParent.get(a.parentId) || []), a]));

  const mergeValues = (a: V, b: V): V => {
    const merged = { ...a } as Record<string, number>;
    for (const field of Object.keys(b)) merged[field] = (merged[field] ?? 0) + b[field];
    return merged as V;
  };

  const build = (account: Account): TreeNode<V> => {
    if (account.isPosting) {
      return { account, value: postingValues.get(account.id) ?? emptyValue, children: [] };
    }
    const children = (byParent.get(account.id) || [])
      .slice()
      .sort((a, b) => a.code.localeCompare(b.code))
      .map(build);
    const value = children.reduce((acc, child) => mergeValues(acc, child.value), emptyValue);
    return { account, value, children };
  };

  return (byParent.get(null) || [])
    .slice()
    .sort((a, b) => a.code.localeCompare(b.code))
    .map(build);
}

/**
 * يقصّ الشجرة عند مستوى أقصى محدَّد: أي عقدة عند هذا المستوى أو أعمق تفقد أبناءها (تصبح "ورقة"
 * ظاهرياً) لكنها تحتفظ بقيمتها الكاملة (الإجمالي التصاعدي المحسوب أصلاً في buildAccountValueTree)
 * دون أي تغيير — هذا هو معنى "المستوى" الصحيح لأي تقرير مالي هرمي في هذا النظام: حدّ أقصى لعمق
 * العرض (مستوى 2 يعني "أظهر المستويين 1 و2 معاً كصفوف إجمالي")، وليس عزل مستوى واحد بمفرده كما
 * كانت rollupAccountValues تفعل (تُبقى تلك الدالة لحالة "فلترة بحساب معيّن + بدون تفاصيل"، حيث
 * المعنى المطلوب مختلف: تجميع فرع كامل في سطر واحد بصرف النظر عن مستواه).
 */
export function truncateTreeDepth<V extends Record<string, number>>(nodes: TreeNode<V>[], maxLevel: number): TreeNode<V>[] {
  return nodes.map((node) => {
    if (node.account.level >= maxLevel) return { ...node, children: [] };
    return { ...node, children: truncateTreeDepth(node.children, maxLevel) };
  });
}

/** يبحث عن عقدة بعينها (بمعرّف حسابها) في أي مكان بالشجرة — يُستخدَم لتقييد قسم كامل (إيرادات/
 * مصروفات أو أصول/التزامات/حقوق ملكية) لفرع واحد فقط عند تفعيل "فلترة بحساب/مجموعة معيّنة". */
export function findTreeNode<V>(nodes: TreeNode<V>[], accountId: string): TreeNode<V> | null {
  for (const node of nodes) {
    if (node.account.id === accountId) return node;
    const found = findTreeNode(node.children, accountId);
    if (found) return found;
  }
  return null;
}

function accountMatchesSearch(account: Account, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    account.name.toLowerCase().includes(q) ||
    (account.nameEn || "").toLowerCase().includes(q) ||
    account.code.toLowerCase().includes(q)
  );
}

/**
 * يشذّب الشجرة تصاعدياً (bottom-up): يُبقي ورقة (حساب ترحيل) فقط لو طابقت البحث (إن وُجد) ولم
 * تكن معدومة الحركة أثناء طلب إخفاء المعدوم؛ ويُبقي أي مجموعة لها فرع واحد باقٍ على الأقل، أو
 * طابق اسمها/كودها هي نفسها البحث رغم عدم وجود فروع باقية (حالة نادرة: بحث باسم مجموعة فارغة).
 * القيم (value) تبقى كما هي دائماً — التشذيب عرضي بحت، لا يغيّر أي رقم إجمالي معروض.
 */
export function pruneTree<V extends Record<string, number>>(
  nodes: TreeNode<V>[],
  options: { hideZeroActivity?: boolean; search?: string; hasActivity?: (value: V) => boolean },
): TreeNode<V>[] {
  const search = options.search?.trim() || "";
  const hasActivity = options.hasActivity || ((v: V) => Object.values(v).some((n) => Math.abs(n) > 0.005));

  const prune = (node: TreeNode<V>): TreeNode<V> | null => {
    if (node.children.length === 0) {
      if (options.hideZeroActivity && !hasActivity(node.value)) return null;
      if (search && !accountMatchesSearch(node.account, search)) return null;
      return node;
    }
    const prunedChildren = node.children.map(prune).filter((n): n is TreeNode<V> => n !== null);
    if (prunedChildren.length > 0) return { ...node, children: prunedChildren };
    if (search && !options.hideZeroActivity && accountMatchesSearch(node.account, search)) {
      return { ...node, children: [] };
    }
    return null;
  };

  return nodes.map(prune).filter((n): n is TreeNode<V> => n !== null);
}
