import { describe, expect, it } from "vitest";
import { isValueTrackedInLedger, isQuantityTracked } from "./items.service";

describe("isValueTrackedInLedger / isQuantityTracked matrix (all item types)", () => {
  const expected: Record<string, { valueTracked: boolean; quantityTracked: boolean }> = {
    inventory: { valueTracked: true, quantityTracked: true },
    expense: { valueTracked: true, quantityTracked: true },
    raw_material: { valueTracked: true, quantityTracked: true },
    bundle: { valueTracked: true, quantityTracked: true },
    service: { valueTracked: false, quantityTracked: false },
    fixed_asset: { valueTracked: false, quantityTracked: false },
    // periodic_inventory: تُتابَع الكمية تشغيلياً (StockMovement) لكن بلا أي أثر محاسبي فوري —
    // الفرق الجوهري الذي فُصلت الدالتان من أجله أصلاً.
    periodic_inventory: { valueTracked: false, quantityTracked: true },
    // non_stock: لا قيمة ولا كمية إطلاقاً — لا يُضاف كاستثناء في isQuantityTracked كما
    // periodic_inventory، فيسقط تلقائياً على القيمة الافتراضية false.
    non_stock: { valueTracked: false, quantityTracked: false },
  };

  for (const [type, exp] of Object.entries(expected)) {
    it(`${type}: valueTracked=${exp.valueTracked}, quantityTracked=${exp.quantityTracked}`, () => {
      expect(isValueTrackedInLedger(type)).toBe(exp.valueTracked);
      expect(isQuantityTracked(type)).toBe(exp.quantityTracked);
    });
  }
});
