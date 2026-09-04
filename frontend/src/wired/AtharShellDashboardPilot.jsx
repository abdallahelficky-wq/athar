import React from "react";
import { useTranslation } from "react-i18next";
import { routes } from "../routes";
import CompanySwitcher from "./shared/CompanySwitcher";
import UnsavedChangesBlocker from "./shared/UnsavedChangesBlocker";
import { usePilotShell } from "./shared/usePilotShell";
import Dashboard from "./Dashboard";
import AtharShell from "../ui/ledger/AtharShell";

/**
 * معاينة تجريبية معزولة تماماً لواجهة "أثر — الدفتر التنفيذي" (AtharShell) — تُستخدَم فقط عبر
 * مسار مستقل (/ui-preview/dashboard)، ولا تستبدل أو تُعدِّل AppShell/المسار الحقيقي /dashboard
 * بأي شكل. كل البيانات (الشركات، الوحدات المرئية، تسجيل الخروج) حقيقية تماماً من نفس المصادر
 * المستخدَمة في AppShell — فقط الغلاف المرئي (هيدر/قائمة جانبية/مركز أوامر) مختلف.
 *
 * التنقّل بين الوحدات (usePilotShell/PILOT_ROUTES): الوحدات المُغلَّفة فعلياً بالهيكل الجديد
 * (لوحة القيادة، المبيعات) تبقى داخل هذا الغلاف عند التنقّل بينها؛ أي وحدة أخرى غير مُغلَّفة بعد
 * تهبط في مسارها الحقيقي القديم (AppShell) — وفي الحالتين يمر الخروج من الصفحة عبر نفس حارس
 * "مسودة غير محفوظة" الحقيقي (UnsavedChangesBlocker مُركَّب هنا أيضاً بشكل مستقل).
 */
export default function AtharShellDashboardPilot() {
  const { t, real, navigate, activeCompany, modules, handleNavigate, handleLogout, readOnlyBanner } = usePilotShell("dashboard");

  return (
    <>
      <UnsavedChangesBlocker />
      <AtharShell
        modules={modules}
        activeModuleId="dashboard"
        onNavigate={handleNavigate}
        companyName={activeCompany?.shortName || activeCompany?.name}
        companyControl={<CompanySwitcher companies={real.companies} companyId={real.companyId} setCompanyId={real.setCompanyId} />}
        modeLabel={t("ledgerUi.pilotBadge")}
        onLogout={handleLogout}
        warningBanner={readOnlyBanner}
      >
        <button type="button" className="outline" style={{ marginBottom: 20 }} onClick={() => navigate(routes.dashboard())}>
          {t("ledgerUi.backToClassicView")}
        </button>
        <Dashboard companies={real.companies} companyId={real.companyId} />
      </AtharShell>
    </>
  );
}
