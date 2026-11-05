import type { Account } from "@prisma/client";
import type { EffectiveClassification } from "./accountClassification";
import type { BalanceDC } from "./financialAnalysis";

/**
 * قائمة التدفقات النقدية بالطريقة غير المباشرة — دالة نقية فوق حركة الفترة (بلا قيود الإقفال).
 *
 * النقدية = الحسابات المعلَّمة "نقدي/بنكي" (isBankOrCash). لأن كل قيد متوازن، تغيّر النقدية يساوي
 * صافي الربح ناقص تغيّر كل حساب ميزانية غير نقدي؛ القائمة تقسّم هذا الحد نفسه على الأنشطة الثلاثة:
 *   تشغيلية  = صافي الربح + الإهلاك + تغيّر الأصول المتداولة (وغير المصنَّفة) وكل الالتزامات عدا القروض
 *   استثمارية = تغيّر الأصول غير المتداولة − الإهلاك (غير نقدي، أُضيف في التشغيلية)
 *   تمويلية  = القروض (دور borrowings، متداولة أو لا) + حقوق الملكية
 * لذلك المطابقة مع رصيد النقدية الافتتاحي والختامي مضمونة حسابياً؛ أي فرق يظهر صريحاً لا يُخفى.
 *
 * الصفوف مجمَّعة على مجموعة المستوى الثالث (أو الحساب نفسه إن كان أعلى) — مستوى عرض القوائم المختصرة، ولا
 * يكشف حسابات الأشخاص (الطيّ يُطبَّق قبل التجميع لغير أدوار الموارد البشرية).
 */

export type CashFlowSection = "operating" | "investing" | "financing";

export interface CashFlowRow {
  groupId: string;
  amount: number;
  unclassified: boolean;
}

export interface CashFlowInput {
  accounts: Pick<Account, "id" | "parentId" | "type" | "level" | "isPosting" | "isBankOrCash">[];
  effective: Map<string, EffectiveClassification>;
  flow: Map<string, BalanceDC>;
  opening: Map<string, BalanceDC>;
  closing: Map<string, BalanceDC>;
  /** خريطة الطيّ (حساب شخص ← مجموعته) لغير أدوار الموارد البشرية؛ فارغة = بلا طيّ */
  fold?: Map<string, { id: string }>;
}

const net = (b: BalanceDC | undefined) => (b ? b.debit - b.credit : 0);
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function computeCashFlow(input: CashFlowInput) {
  const byId = new Map(input.accounts.map((a) => [a.id, a]));
  const displayGroup = (accountId: string) => {
    let id = input.fold?.get(accountId)?.id ?? accountId;
    for (let depth = 0; depth < 16; depth++) {
      const a = byId.get(id);
      if (!a || a.level <= 3 || !a.parentId) return id;
      id = a.parentId;
    }
    return id;
  };

  let netIncome = 0;
  let depreciation = 0;
  let openingCash = 0;
  let closingCash = 0;
  const rows: Record<CashFlowSection, Map<string, CashFlowRow>> = { operating: new Map(), investing: new Map(), financing: new Map() };
  const add = (section: CashFlowSection, accountId: string, amount: number, unclassified: boolean) => {
    const groupId = displayGroup(accountId);
    const row = rows[section].get(groupId) || { groupId, amount: 0, unclassified: false };
    row.amount += amount;
    row.unclassified ||= unclassified;
    rows[section].set(groupId, row);
  };

  for (const account of input.accounts) {
    if (!account.isPosting) continue;
    const delta = net(input.flow.get(account.id));
    const cls = input.effective.get(account.id);
    if (account.type === "revenue" || account.type === "expense") {
      netIncome -= delta;
      if (account.type === "expense" && cls?.analysisRole === "depreciation") depreciation += delta;
      continue;
    }
    if (account.isBankOrCash && account.type === "asset") {
      openingCash += net(input.opening.get(account.id));
      closingCash += net(input.closing.get(account.id));
      continue;
    }
    if (Math.abs(delta) < 0.005) continue;
    const cashEffect = -delta;
    if (account.type === "equity" || (account.type === "liability" && cls?.analysisRole === "borrowings")) {
      add("financing", account.id, cashEffect, false);
    } else if (account.type === "asset" && cls?.liquidity === "non_current") {
      add("investing", account.id, cashEffect, false);
    } else {
      add("operating", account.id, cashEffect, account.type === "asset" && !cls?.liquidity);
    }
  }

  const list = (section: CashFlowSection) =>
    [...rows[section].values()].filter((r) => Math.abs(r.amount) >= 0.005).map((r) => ({ ...r, amount: r2(r.amount) }));
  const sum = (section: CashFlowSection) => [...rows[section].values()].reduce((s, r) => s + r.amount, 0);
  const operating = netIncome + depreciation + sum("operating");
  const investing = sum("investing") - depreciation;
  const financing = sum("financing");
  const netChange = operating + investing + financing;
  return {
    netIncome: r2(netIncome),
    depreciation: r2(depreciation),
    operating: { rows: list("operating"), total: r2(operating) },
    investing: { rows: list("investing"), total: r2(investing) },
    financing: { rows: list("financing"), total: r2(financing) },
    netChange: r2(netChange),
    openingCash: r2(openingCash),
    closingCash: r2(closingCash),
    difference: r2(closingCash - openingCash - netChange),
  };
}
