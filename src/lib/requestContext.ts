import { AsyncLocalStorage } from "async_hooks";

/**
 * سياق طلب المستخدم الحالي (P4، docs/design/subscription-plans.md §5) — يبدأ في authenticate ويرافق كل استعلام يُنفَّذ أثناء
 * الطلب، فيستطيع حارس الكتابة في طبقة البيانات (subscriptionWriteGuard) أن يعرف أن الكتابة جاءت من طلب مستخدم، وبأي فعل HTTP،
 * وأي وحدة (صلاحية) يكتب فيها الطلب. يبدأ أيضاً في authenticateEmployeePortal (مراجعة #164): كتابات بوابة الموظف — الحضور، طلبات
 * الإجازة، ورديات المحطات — تُفحَص على شركة الموظف كأي طلب مستخدم. المهام الخلفية (المُجدوِلات) ولوحة مدير المنصة لا سياق لها،
 * فلا يمسّها الحارس.
 */
export type RequestContext = {
  tenantId: string;
  /** المستخدم صاحب الطلب — null لطلب بوابة الموظف */
  userId: string | null;
  /** الموظف صاحب طلب بوابة الموظف */
  employeeId?: string;
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
