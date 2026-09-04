import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useCompanies } from "../useCompanies";
import { NAV_GROUPS } from "../../App";

/**
 * الوحدات المُغلَّفة فعلياً بهيكل أثر الجديد حتى الآن، وموقع كل واحدة منها ضمن مسارات المعاينة
 * (/ui-preview/*). أي قسم غير موجود هنا يُعتبر "غير مُغلَّف بعد" — النقر عليه من القائمة الجديدة
 * ينقل فعلياً (عبر react-router) إلى مساره الحقيقي القديم (AppShell)، تماماً كسلوك المرحلة الأولى.
 * إضافة قسم جديد للتجربة لاحقاً = سطر واحد هنا فقط.
 */
export const PILOT_ROUTES = {
  dashboard: () => "/ui-preview/dashboard",
  sales: (tab = "invoices") => `/ui-preview/sales/${tab}`,
};

/**
 * منطق مشترك بين كل صفحات معاينة هيكل أثر (AtharShellDashboardPilot، AtharShellSalesPilot، ...):
 * نفس تصفية الوحدات المرئية المستخدَمة في AppShell (صلاحيات المنصة + نشاط الشركة)، ونفس منطق
 * التنقّل بين الوحدات المُغلَّفة (يبقى داخل الهيكل الجديد) وغير المُغلَّفة (يهبط في الهيكل القديم).
 */
export function usePilotShell(activeModuleId) {
  const { t } = useTranslation();
  const { tenant, logout } = useAuth();
  const real = useCompanies();
  const navigate = useNavigate();

  const activeCompany = useMemo(
    () => real.companies.find((c) => c.id === real.companyId),
    [real.companies, real.companyId],
  );

  const visibleNavGroups = useMemo(
    () =>
      NAV_GROUPS.filter((group) => {
        const platformAllows = !tenant?.enabledModules?.length || tenant.enabledModules.includes(group.id);
        const activityAllows = group.id !== "stables" || activeCompany?.businessActivity === "horse_stables";
        return platformAllows && activityAllows;
      }),
    [tenant, activeCompany],
  );

  const modules = useMemo(
    () => [
      { id: "dashboard", label: t("nav.dashboard"), title: t("ledgerUi.dashboardTitle"), icon: "dashboard" },
      ...visibleNavGroups.map((g) => ({ id: g.id, label: t(g.labelKey), icon: g.id })),
    ],
    [visibleNavGroups, t],
  );

  const handleNavigate = (moduleId) => {
    if (moduleId === activeModuleId) return;
    if (PILOT_ROUTES[moduleId]) {
      navigate(PILOT_ROUTES[moduleId]());
      return;
    }
    const group = NAV_GROUPS.find((g) => g.id === moduleId);
    if (group) navigate(group.to());
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return { t, real, tenant, navigate, activeCompany, modules, handleNavigate, handleLogout };
}
