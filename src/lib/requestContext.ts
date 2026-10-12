import { AsyncLocalStorage } from "async_hooks";

/**
 * سياق طلب المستخدم الحالي (P4، docs/design/subscription-plans.md §5) — يبدأ في authenticate ويرافق كل استعلام يُنفَّذ أثناء
 * الطلب، فيستطيع حارس الكتابة في طبقة البيانات (subscriptionWriteGuard) أن يعرف أن الكتابة جاءت من طلب مستخدم، وبأي فعل HTTP،
 * وأي وحدة (صلاحية) يكتب فيها الطلب. المهام الخلفية (المُجدوِلات) وبوابة الموظف ولوحة مدير المنصة لا سياق لها، فلا يمسّها الحارس.
 */
export type RequestContext = {
  tenantId: string;
  userId: string;
  method: string;
  /** وحدات طلب الطلبُ عليها إجراء كتابة (create/edit/delete/approve) عبر requirePositionAction */
  writeResources: Set<string>;
};

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
