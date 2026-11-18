import React from "react";
import { useOutletContext } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { PayrollTotalsSettings } from "../CompaniesSettings";

/** «ترحيل الرواتب كإجماليات» — للمالك وحده، انتقل من صفحة الإعدادات إلى إعدادات الرواتب */
export default function PayrollTotalsPanel() {
  const { user, tenant } = useAuth();
  const { realCompanies = [], reloadRealCompanies } = useOutletContext() || {};
  const isOwner = user?.role === "super_admin" || (tenant?.ownerId && tenant.ownerId === user?.id);
  if (!isOwner || realCompanies.length === 0) return null;
  return <PayrollTotalsSettings companies={realCompanies} reload={reloadRealCompanies} />;
}
