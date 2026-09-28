import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ item: { findMany: vi.fn() }, company: { findFirst: vi.fn() }, supplier: { findFirst: vi.fn() }, account: { findMany: vi.fn() }, purchaseInvoice: { findFirst: vi.fn(), update: vi.fn() }, purchaseInvoiceLine: { deleteMany: vi.fn() }, $transaction: vi.fn() }));
vi.mock("../../lib/prisma", () => ({ prisma: db }));
import { updatePurchaseInvoice } from "./purchaseInvoices.service";
import { createPurchaseInvoiceSchema } from "./purchaseInvoices.schemas";
beforeEach(() => {
 vi.clearAllMocks(); db.company.findFirst.mockResolvedValue({id:"c"}); db.supplier.findFirst.mockResolvedValue({id:"s"}); db.account.findMany.mockResolvedValue([{id:"expense"}]); db.purchaseInvoice.findFirst.mockResolvedValue({status:"draft"}); db.purchaseInvoice.update.mockImplementation(async (arg) => arg.data); db.$transaction.mockImplementation(async fn => fn(db));
});
it.each(["E", "Z", "S"] as const)("persists catalog %s tax on purchase lines for legacy callers", async category => {
 db.item.findMany.mockResolvedValue([{id:"item",type:"non_stock",expenseAccountId:"expense",taxCategoryCode:category,taxExemptionReasonCode: category === "E" ? "VATEX-SA-30" : "VATEX-SA-35",taxExemptionReason:"reason"}]);
 const input = createPurchaseInvoiceSchema.parse({companyId:"c",supplierId:"s",date:"2026-09-28",lines:[{accountId:"item",itemId:"item",quantity:90,unitPrice:760}]});
 const saved = await updatePurchaseInvoice("tenant","invoice",input);
 expect(saved).toMatchObject({subtotal:68400,vatTotal:category === "S" ? 10260 : 0,grandTotal:category === "S" ? 78660 : 68400});
 expect((saved as any).lines.create[0]).toMatchObject({taxCategoryCode:category,vatApplicable:category === "S"});
});
it("retains an explicit zero-rate snapshot after catalog changes", async () => {
 db.item.findMany.mockResolvedValue([{id:"item",type:"non_stock",expenseAccountId:"expense",taxCategoryCode:"S"}]);
 const input = createPurchaseInvoiceSchema.parse({companyId:"c",supplierId:"s",date:"2026-09-28",lines:[{accountId:"item",itemId:"item",quantity:90,unitPrice:760,priceIncludesVat:true,taxCategoryCode:"Z",taxExemptionReasonCode:"VATEX-SA-35",taxExemptionReason:"reason"}]});
 const saved = await updatePurchaseInvoice("tenant","invoice",input);
 expect(saved).toMatchObject({subtotal:68400,vatTotal:0,grandTotal:68400});
 expect((saved as any).lines.create[0].taxCategoryCode).toBe("Z");
});

it.each(["E", "Z"] as const)("accepts purchase %s without a reason", async category => {
 db.item.findMany.mockResolvedValue([{id:"item",type:"non_stock",expenseAccountId:"expense",taxCategoryCode:"S"}]);
 const input=createPurchaseInvoiceSchema.parse({companyId:"c",supplierId:"s",date:"2026-09-28",lines:[{accountId:"item",itemId:"item",quantity:90,unitPrice:760,taxCategoryCode:category}]});
 const saved=await updatePurchaseInvoice("tenant","invoice",input);
 expect(saved).toMatchObject({vatTotal:0,grandTotal:68400});
 expect((saved as any).lines.create[0]).toMatchObject({taxCategoryCode:category,taxExemptionReasonCode:null,taxExemptionReason:null});
});
