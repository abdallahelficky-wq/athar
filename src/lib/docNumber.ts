/** رقم مستند تسلسلي بصيغة PREFIX-00001 — يأخذ عدد المستندات الحالية للمستأجر ويُرجع التالي */
export function formatDocNumber(prefix: string, existingCount: number): string {
  return `${prefix}-${String(existingCount + 1).padStart(5, "0")}`;
}
