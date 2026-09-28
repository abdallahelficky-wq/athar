// نفس HR_READ_ROLES في src/middleware/auth.ts — للعرض فقط؛ الخادم هو من يطوي ويمنع فعلياً
const HR_READ_ROLES = ["super_admin", "admin", "finance_manager", "hr_manager"];

export const canReadHrData = (user) => HR_READ_ROLES.includes(user?.role);
