import React, { useEffect } from "react";
import { PrintShell, printWithOrientation } from "../../legacy/shared";
import { fmt } from "../../legacy/constants";

/**
 * بطاقة أصل ثابت قابلة للطباعة — تُفتَح من زر "طباعة البطاقة" في سجل الأصول. تعرض كل بيانات
 * الأصل التعريفية والإهلاكية في مكان واحد (بدل تصفّح شاشة التعديل)، لتُرفَق مادياً بالأصل نفسه
 * أو تُحفظ في ملفه. رقم الهيكل/اللوحة والعهدة والموقع تظهر فقط لو موجودة فعلاً على هذا الأصل.
 */
export default function AssetCardPrintModal({ asset, companies, employees, costCenters, autoPrint, onClose }) {
  useEffect(() => {
    if (!autoPrint) return;
    const t = setTimeout(() => printWithOrientation(false), 200);
    return () => clearTimeout(t);
  }, [autoPrint, asset.id]);

  const company = companies?.find((c) => c.id === asset.companyId);
  const employee = employees?.find((e) => e.id === asset.custodianEmployeeId);
  const costCenter = costCenters?.find((c) => c.id === asset.costCenterId);
  const annualDepreciationRate = Number(asset.usefulLifeYears) > 0 ? (100 / Number(asset.usefulLifeYears)).toFixed(2) : null;

  return (
    <PrintShell
      subtitle="بطاقة أصل ثابت"
      company={company}
      refNode={
        <>
          <div>رقم الأصل: <strong>{asset.assetNumber}</strong></div>
          <div>الحالة: <strong>{asset.status === "disposed" ? "مستبعد" : "نشط"}</strong></div>
        </>
      }
      onClose={onClose}
    >
      <div className="voucher-meta">
        <div><span>اسم الأصل</span><strong>{asset.name}</strong></div>
        <div><span>الفئة/التصنيف</span><strong>{asset.category || "—"}</strong></div>
        <div><span>تاريخ الشراء</span><strong>{asset.purchaseDate.slice(0, 10)}</strong></div>
        <div><span>تاريخ بدء الإهلاك</span><strong>{asset.depreciationStartDate ? asset.depreciationStartDate.slice(0, 10) : asset.purchaseDate.slice(0, 10)}</strong></div>
        <div><span>التكلفة</span><strong>{fmt(asset.cost)}</strong></div>
        <div><span>القيمة التخريدية</span><strong>{fmt(asset.salvageValue)}</strong></div>
        <div><span>العمر الإنتاجي</span><strong>{Number(asset.usefulLifeYears)} سنوات</strong></div>
        <div><span>نسبة الإهلاك السنوية</span><strong>{annualDepreciationRate ? `${annualDepreciationRate}%` : "—"}</strong></div>
        <div><span>طريقة الإهلاك</span><strong>{asset.depreciationMethod === "declining_balance" ? "قسط متناقص" : "قسط ثابت"}</strong></div>
        <div><span>مجمع الإهلاك حتى اليوم</span><strong>{fmt(asset.accumulatedDepreciation)}</strong></div>
        <div><span>صافي القيمة الدفترية</span><strong>{fmt(asset.netBookValue)}</strong></div>
        {asset.serialNumber && <div><span>الرقم التسلسلي</span><strong>{asset.serialNumber}</strong></div>}
        {asset.chassisNumber && <div><span>رقم الهيكل</span><strong>{asset.chassisNumber}</strong></div>}
        {asset.plateNumber && <div><span>رقم اللوحة</span><strong>{asset.plateNumber}</strong></div>}
        {costCenter && <div><span>الموقع/الفرع</span><strong>{costCenter.name}</strong></div>}
        {employee && <div><span>عهدة لدى</span><strong>{employee.name}</strong></div>}
      </div>
    </PrintShell>
  );
}
