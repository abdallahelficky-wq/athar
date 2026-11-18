import React from "react";
import { useTranslation } from "react-i18next";
import { useOutletContext } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import CompanySettingsSections from "./CompanySettingsSections";
import { BalancesPostedOnlySettings } from "./CompaniesSettings";

/** إعدادات الحسابات: السنة المالية والإقفال، ترقيم القيود، الحسابات البنكية، و(للمالك) الأرصدة المرحَّلة فقط */
export default function AccountsSettingsTab({ companyId }) {
  const { t } = useTranslation();
  const { user, tenant } = useAuth();
  const { realCompanies = [], reloadRealCompanies } = useOutletContext() || {};
  const isOwner = user?.role === "super_admin" || (tenant?.ownerId && tenant.ownerId === user?.id);
  const extraSections = isOwner && realCompanies.length > 0 ? [{
    key: "balancesPostedOnly", icon: "sScale", group: "accounting",
    label: t("settings.companyEdit.tabs.balancesPostedOnly"), desc: t("settings.companyEdit.cards.balancesPostedOnly"),
    render: () => <BalancesPostedOnlySettings companies={realCompanies} reload={reloadRealCompanies} />,
  }] : [];
  return <CompanySettingsSections companyId={companyId} only={["fiscal", "numbering", "bankAccounts"]} extraSections={extraSections} />;
}
