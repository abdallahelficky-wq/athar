import { Router } from "express";
import { authenticate, enforceCompanyScope, blockMutationsWhenReadOnly, requireActionPermission } from "../../middleware/auth";
import { salesVolumeHandler, cashSummaryHandler, expensesHandler, netCashHandler, seedDataExceptionsHandler } from "./stationShiftsReports.controller";

/**
 * تقارير ورديات المحطات — قراءة فقط، بنفس نمط بقية وحدات "-reports" في النظام تماماً
 * (salesReports/purchaseReports/hrReports/inventoryReports): authenticate + enforceCompanyScope +
 * blockMutationsWhenReadOnly على مستوى الراوتر كله، بلا أي صلاحية Position إضافية — حجم
 * المبيعات/إجمالي النقدية/إجمالي المصروفات/"البنك" ليست بيانات حسّاسة بنفس معنى عجز/زيادة الصندوق.
 *
 * صافي النقدية واستثناءات بيانات البذرة استثناءان وحيدان متعمَّدان: تُضاف صلاحية "review" نفسها
 * المستخدَمة في stationShifts.routes.ts لشاشة المحاسب — نفس مبدأ ذلك الملف الذي يخصّص مستوى صلاحية
 * مختلفاً لكل مسار على حدة (reviewAccess مقابل postAccess) بدل صلاحية واحدة موحَّدة لكل الراوتر.
 * استثناءات البذرة ليست رقماً مالياً حسّاساً بذاتها، لكنها أداة تدقيق مباشرة لسلامة كل تقرير آخر
 * هنا، فتبقى خلف نفس الصلاحية. لا مسار من بوابة الموظف (authenticateEmployeePortal) يصل لهذا الملف
 * إطلاقاً — هذا الراوتر لا يُركَّب إلا تحت authenticate (User/Position) في app.ts.
 */
export const stationShiftsReportRoutes = Router();
stationShiftsReportRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const netCashAccess = requireActionPermission("stationShifts", "review", "approve");

stationShiftsReportRoutes.get("/sales-volume", salesVolumeHandler);
stationShiftsReportRoutes.get("/cash-summary", cashSummaryHandler);
stationShiftsReportRoutes.get("/expenses", expensesHandler);
stationShiftsReportRoutes.get("/net-cash", netCashAccess, netCashHandler);
stationShiftsReportRoutes.get("/seed-data-exceptions", netCashAccess, seedDataExceptionsHandler);
