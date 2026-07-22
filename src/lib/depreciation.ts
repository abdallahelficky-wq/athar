/**
 * الإهلاك المتراكم بطريقة القسط الثابت حتى تاريخ معيّن — مطابق حرفياً لدالة
 * assetAccumulatedDepreciation في AtharAlMuhasabi.jsx.
 */
export function accumulatedDepreciation(
  asset: { cost: number; salvageValue: number; usefulLifeYears: number; purchaseDate: Date },
  uptoDate: Date,
): number {
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

export function monthlyDepreciation(asset: { cost: number; salvageValue: number; usefulLifeYears: number }): number {
  if (!asset.usefulLifeYears || asset.usefulLifeYears <= 0) return 0;
  return (asset.cost - (asset.salvageValue || 0)) / asset.usefulLifeYears / 12;
}
