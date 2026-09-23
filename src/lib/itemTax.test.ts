import { describe, expect, it } from "vitest";
import { normalizeTax, assertCompatibleTaxReasons } from "./itemTax";
import { computeInvoiceLine } from "./invoiceLine";
import { createItemSchema, updateItemSchema } from "../modules/items/items.schemas";
describe("item VAT treatment", () => {
 it("preserves old classifications and accepts optional English names", () => {
  expect(normalizeTax({vatApplicable:false}).taxCategoryCode).toBe("O");
  expect(normalizeTax({}).taxCategoryCode).toBe("S");
  expect(createItemSchema.parse({companyId:"c",code:"1",name:"صنف",nameEn:" Item ",type:"service",revenueAccountId:"r",priceIncludesVat:false}).nameEn).toBe("Item");
  expect(updateItemSchema.parse({nameEn:null})).toEqual({nameEn:null});
 });
 it.each(["E","Z"] as const)("%s remains zero even with an old true VAT checkbox", (taxCategoryCode) => {
  for (const priceIncludesVat of [true,false]) expect(computeInvoiceLine({quantity:2,unitPrice:100,discountPct:10,priceIncludesVat,vatApplicable:true,taxCategoryCode})).toEqual({subtotal:180,vat:0,total:180});
 });
 it("distinguishes inclusive and exclusive prices", () => {
  expect(computeInvoiceLine({quantity:1,unitPrice:100,priceIncludesVat:false,taxCategoryCode:"S"})).toEqual({subtotal:100,vat:15,total:115});
  expect(computeInvoiceLine({quantity:1,unitPrice:115,priceIncludesVat:true,taxCategoryCode:"S"})).toEqual({subtotal:100,vat:15,total:115});
 });
 it("requires a matching exemption code and reason without inventing one", () => {
  expect(() => normalizeTax({taxCategoryCode:"E"})).toThrow();
  expect(() => normalizeTax({taxCategoryCode:"E",taxExemptionReasonCode:"VATEX-SA-35",taxExemptionReason:"Medicine"})).toThrow();
  expect(normalizeTax({taxCategoryCode:"Z",taxExemptionReasonCode:"VATEX-SA-35",taxExemptionReason:"Medicine"})).toMatchObject({taxCategoryCode:"Z",vatApplicable:false,taxExemptionReasonCode:"VATEX-SA-35"});
  expect(normalizeTax({taxCategoryCode:"S",taxExemptionReasonCode:"VATEX-SA-35",taxExemptionReason:"Medicine"}).taxExemptionReasonCode).toBeNull();
 });
});

it("does not silently discard different exemption reasons in the same VAT group", () => {
 expect(() => assertCompatibleTaxReasons([{taxCategoryCode:"Z",taxExemptionReasonCode:"VATEX-SA-35"},{taxCategoryCode:"Z",taxExemptionReasonCode:"VATEX-SA-32"}])).toThrow();
 expect(() => assertCompatibleTaxReasons([{taxCategoryCode:"Z",taxExemptionReasonCode:"VATEX-SA-35"},{taxCategoryCode:"E",taxExemptionReasonCode:"VATEX-SA-29"}])).not.toThrow();
});
