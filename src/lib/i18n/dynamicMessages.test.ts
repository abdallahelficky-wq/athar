import { describe, it, expect } from "vitest";
import { translateMessage } from "./translate";

describe("dynamic (interpolated) message translation", () => {
  it("translates the customer delete-blocked reasons list", () => {
    const ar = 'لا يمكن حذف هذا العميل لارتباطه بـ 5 فاتورة مبيعات، 2 عرض سعر. عدّل بيانات العميل بدلاً من حذفه إن لزم الأمر.';
    expect(translateMessage(ar, "en")).toBe(
      "Can't delete this customer because it's linked to 5 sales invoice(s), 2 quotation(s). Edit the customer's data instead of deleting it if needed.",
    );
  });

  it("translates the supplier delete-blocked reasons list", () => {
    const ar = 'لا يمكن حذف هذا المورد لارتباطه بـ 3 فاتورة مشتريات. عدّل بيانات المورد بدلاً من حذفه إن لزم الأمر.';
    expect(translateMessage(ar, "en")).toBe(
      "Can't delete this supplier because it's linked to 3 purchase invoice(s). Edit the supplier's data instead of deleting it if needed.",
    );
  });

  it("translates the account delete-blocked reasons list (joined with Arabic 'و')", () => {
    const ar = 'لا يمكن حذف الحساب لوجود 3 حسابات فرعية و2 حركات أو قيود مرتبطة. استخدم الأرشفة بدلاً من الحذف.';
    expect(translateMessage(ar, "en")).toBe(
      "Can't delete this account because it has 3 sub-accounts and 2 linked transactions or entries. Use archiving instead of deleting.",
    );
  });

  it("translates an item-name-quoted message", () => {
    expect(translateMessage('الصنف "قلم رصاص" من نوع خدمي، لا يمكن شراؤه', "en")).toBe(
      'Item "قلم رصاص" is a service-type item, it can\'t be purchased',
    );
  });

  it("translates the account-type move-blocked message via the type label map", () => {
    const ar = 'لا يمكن نقل حساب من نوع "أصول" إلى مجموعة من نوع "التزامات" — النقل مسموح فقط بين مجموعات من نفس النوع.';
    expect(translateMessage(ar, "en")).toBe(
      'Can\'t move an account of type "Assets" into a group of type "Liabilities" — moving is only allowed between groups of the same type.',
    );
  });

  it("translates an asset-role account message", () => {
    expect(translateMessage("حساب اقتناء الأصل: الحساب المختار غير موجود ضمن شجرة هذه الشركة", "en")).toBe(
      "Asset acquisition account: the selected account does not exist in this company's chart of accounts",
    );
    expect(translateMessage("حساب مصروف الإهلاك: نوع الحساب المختار غير مطابق (متوقَّع expense)", "en")).toBe(
      "Depreciation expense account: the selected account's type doesn't match (expected expense)",
    );
  });

  it("translates an Arabic month/year embedded in a payroll-run-exists message", () => {
    expect(translateMessage("يوجد كشف رواتب لشهر أغسطس ٢٠٢٦ لهذه الشركة بالفعل", "en")).toBe(
      "A payroll run for August 2026 already exists for this company",
    );
  });

  it("translates the item-required-fields list by reusing AR_TO_EN entries", () => {
    expect(translateMessage("الحقول التالية مطلوبة لهذا النوع من الأصناف: حساب المخزون، حساب الإيراد", "en")).toBe(
      "The following fields are required for this item type: Inventory account, Revenue account",
    );
  });

  it("translates a ZATCA rejection message including the 'no response' fallback", () => {
    expect(translateMessage("رفضت زاتكا طلب شهادة الاختبار: لا يوجد رد", "en")).toBe(
      "ZATCA rejected the compliance certificate request: No response",
    );
  });

  it("falls back to the original Arabic text when nothing matches", () => {
    const ar = "رسالة غير معروفة تماماً لم تُضَف لأي قاموس";
    expect(translateMessage(ar, "en")).toBe(ar);
  });

  it("never translates when lang is ar", () => {
    expect(translateMessage("الصنف \"قلم رصاص\" من نوع خدمي، لا يمكن شراؤه", "ar")).toBe(
      "الصنف \"قلم رصاص\" من نوع خدمي، لا يمكن شراؤه",
    );
  });
});
