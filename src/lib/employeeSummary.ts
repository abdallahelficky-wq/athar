/**
 * حقول تعريف الموظف وحدها — بلا راتب ولا بدلات ولا هوية ولا حساب بنكي ولا بيانات شخصية. تُستخدَم في كل
 * استجابة تُضمِّن الموظف لغير أدوار الموارد البشرية: قائمة الموظفين كمنتقٍ (محاسب، مشاهدة فقط)، وطلبات
 * الإجازة (شاشة الطلبات بصلاحية leaveRequests، وبوابة الجوال للمدير المباشر). أي include كامل للموظف
 * (employee: true) في مسار يصله غير أدوار الموارد البشرية يكشف الرواتب.
 */
export const EMPLOYEE_SUMMARY_SELECT = {
  id: true,
  companyId: true,
  name: true,
  employeeNumber: true,
  jobTitle: true,
  department: true,
  status: true,
  assignedCostCenterId: true,
  accountId: true,
  managerId: true,
} as const;
