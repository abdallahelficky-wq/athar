/**
 * الإهلاك المتراكم بطريقة القسط الثابت حتى تاريخ معيّن — مطابق حرفياً لدالة
 * assetAccumulatedDepreciation في AtharAlMuhasabi.jsx.
 */
export function accumulatedDepreciation(
  asset: { cost: number; salvageValue: number; usefulLifeYears: number; purchaseDate: Date; isDepreciable?: boolean },
  uptoDate: Date,
): number {
  if (asset.isDepreciable === false) return 0;
  if (!asset.usefulLifeYears || asset.usefulLifeYears <= 0) return 0;
  const monthlyDep = (asset.cost - (asset.salvageValue || 0)) / asset.usefulLifeYears / 12;
  const monthsElapsed = Math.max(
    (uptoDate.getFullYear() - asset.purchaseDate.getFullYear()) * 12 +
      (uptoDate.getMonth() - asset.purchaseDate.getMonth()),
    0,
  );
  const maxDep = asset.cost - (asset.salvageValue || 0);
  return Math.min(monthlyDep * monthsElapsed, maxDep);
}

export function monthlyDepreciation(asset: { cost: number; salvageValue: number; usefulLifeYears: number; isDepreciable?: boolean }): number {
  if (asset.isDepreciable === false) return 0;
  if (!asset.usefulLifeYears || asset.usefulLifeYears <= 0) return 0;
  return (asset.cost - (asset.salvageValue || 0)) / asset.usefulLifeYears / 12;
}

/** عدد الأشهر الصحيحة بين شهرَي تاريخين (تجاهل الأيام) — نفس منطق accumulatedDepreciation أعلاه. */
function monthIndexDiff(later: Date, earlier: Date): number {
  return (later.getFullYear() - earlier.getFullYear()) * 12 + (later.getMonth() - earlier.getMonth());
}

type ExistingAssetInput = {
  cost: number;
  salvageValue: number;
  usefulLifeYears: number;
  isDepreciable?: boolean;
  openingAccumulatedDepreciation: number;
  openingDepreciationAsOf: Date;
};

/**
 * الإهلاك المتراكم لـ"أصل قائم" (مسجَّل في الدفاتر قبل السجل): المجمع الافتتاحي المُرحَّل فعلاً + قسط شهري لكل
 * شهر بعد شهر openingDepreciationAsOf، بسقف التكلفة − القيمة التخريدية. المجمع الافتتاحي نفسه يُقصّ بالسقف.
 */
export function accumulatedDepreciationExisting(asset: ExistingAssetInput, uptoDate: Date): number {
  const maxDep = asset.cost - (asset.salvageValue || 0);
  const opening = Math.min(Math.max(asset.openingAccumulatedDepreciation || 0, 0), maxDep);
  if (asset.isDepreciable === false) return opening;
  const monthly = monthlyDepreciation(asset);
  const monthsAfter = Math.max(monthIndexDiff(uptoDate, asset.openingDepreciationAsOf), 0);
  return Math.min(opening + monthly * monthsAfter, maxDep);
}

/**
 * قسط شهر محدد (YYYY-MM) لأصل قائم في دورة الإهلاك الشهري: صفر إن كان الشهر ≤ شهر المجمع الافتتاحي (مُرحَّل
 * فعلاً في الدفاتر — منع إهلاك مزدوج)، وإلا القسط الشهري مقصوراً على ما تبقّى من القيمة القابلة للإهلاك.
 */
export function existingAssetChargeForMonth(asset: ExistingAssetInput, month: string): number {
  if (asset.isDepreciable === false) return 0;
  const [y, m] = month.split("-").map(Number);
  const monthStart = new Date(y, m - 1, 1);
  const monthsAfter = monthIndexDiff(monthStart, asset.openingDepreciationAsOf);
  if (monthsAfter <= 0) return 0;
  const maxDep = asset.cost - (asset.salvageValue || 0);
  const opening = Math.min(Math.max(asset.openingAccumulatedDepreciation || 0, 0), maxDep);
  const monthly = monthlyDepreciation(asset);
  const accumulatedBefore = Math.min(opening + monthly * (monthsAfter - 1), maxDep);
  return Math.max(Math.min(monthly, maxDep - accumulatedBefore), 0);
}
