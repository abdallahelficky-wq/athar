import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { PrintShell, printWithOrientation } from "../../legacy/shared";
import { fmt } from "../../legacy/constants";

/**
 * بطاقة أصل ثابت قابلة للطباعة — تُفتَح من زر "طباعة البطاقة" في سجل الأصول. تعرض كل بيانات
 * الأصل التعريفية والإهلاكية في مكان واحد (بدل تصفّح شاشة التعديل)، لتُرفَق مادياً بالأصل نفسه
 * أو تُحفظ في ملفه. رقم الهيكل/اللوحة والعهدة والموقع تظهر فقط لو موجودة فعلاً على هذا الأصل.
 */
export default function AssetCardPrintModal({ asset, companies, employees, costCenters, autoPrint, onClose }) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!autoPrint) return;
    const timer = setTimeout(() => printWithOrientation(false), 200);
    return () => clearTimeout(timer);
  }, [autoPrint, asset.id]);

  const company = companies?.find((c) => c.id === asset.companyId);
  const employee = employees?.find((e) => e.id === asset.custodianEmployeeId);
  const costCenter = costCenters?.find((c) => c.id === asset.costCenterId);
  const annualDepreciationRate = Number(asset.usefulLifeYears) > 0 ? (100 / Number(asset.usefulLifeYears)).toFixed(2) : null;

  return (
    <PrintShell
      subtitle={t("fixedAssets.printCard.subtitle")}
      company={company}
      refNode={
        <>
          <div>{t("fixedAssets.printCard.assetNumber")}: <strong>{asset.assetNumber}</strong></div>
          <div>{t("fixedAssets.printCard.status")}: <strong>{asset.status === "disposed" ? t("fixedAssets.status.disposed") : t("fixedAssets.status.active")}</strong></div>
        </>
      }
      onClose={onClose}
    >
      <div className="voucher-meta">
        <div><span>{t("fixedAssets.printCard.name")}</span><strong>{asset.name}</strong></div>
        <div><span>{t("fixedAssets.printCard.category")}</span><strong>{asset.category || "—"}</strong></div>
        <div><span>{t("fixedAssets.printCard.purchaseDate")}</span><strong>{asset.purchaseDate.slice(0, 10)}</strong></div>
        <div><span>{t("fixedAssets.printCard.depreciationStartDate")}</span><strong>{asset.depreciationStartDate ? asset.depreciationStartDate.slice(0, 10) : asset.purchaseDate.slice(0, 10)}</strong></div>
        <div><span>{t("fixedAssets.printCard.cost")}</span><strong>{fmt(asset.cost)}</strong></div>
        <div><span>{t("fixedAssets.printCard.salvageValue")}</span><strong>{fmt(asset.salvageValue)}</strong></div>
        <div><span>{t("fixedAssets.printCard.usefulLifeYears")}</span><strong>{Number(asset.usefulLifeYears)} {t("fixedAssets.printCard.years")}</strong></div>
        <div><span>{t("fixedAssets.printCard.annualDepreciationRate")}</span><strong>{annualDepreciationRate ? `${annualDepreciationRate}%` : "—"}</strong></div>
        <div><span>{t("fixedAssets.printCard.depreciationMethod")}</span><strong>{t(asset.depreciationMethod === "declining_balance" ? "fixedAssets.depreciationMethod.declining_balance" : "fixedAssets.depreciationMethod.straight_line")}</strong></div>
        <div><span>{t("fixedAssets.printCard.accumulatedDepreciation")}</span><strong>{fmt(asset.accumulatedDepreciation)}</strong></div>
        <div><span>{t("fixedAssets.printCard.netBookValue")}</span><strong>{fmt(asset.netBookValue)}</strong></div>
        {asset.serialNumber && <div><span>{t("fixedAssets.printCard.serialNumber")}</span><strong>{asset.serialNumber}</strong></div>}
        {asset.chassisNumber && <div><span>{t("fixedAssets.printCard.chassisNumber")}</span><strong>{asset.chassisNumber}</strong></div>}
        {asset.plateNumber && <div><span>{t("fixedAssets.printCard.plateNumber")}</span><strong>{asset.plateNumber}</strong></div>}
        {costCenter && <div><span>{t("fixedAssets.printCard.location")}</span><strong>{costCenter.name}</strong></div>}
        {employee && <div><span>{t("fixedAssets.printCard.custodian")}</span><strong>{employee.name}</strong></div>}
      </div>
    </PrintShell>
  );
}
