import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../lib/prisma",()=>({prisma:{company:{findFirst:vi.fn()},item:{findFirst:vi.fn(),update:vi.fn()},$transaction:vi.fn()}}));
import { prisma } from "../../lib/prisma";
import { createItemWithComponents, updateItemWithValidation } from "./items.service";
const original={id:"i",companyId:"c",tenantId:"t",name:"صنف",nameEn:"Item",type:"service",revenueAccountId:"r",taxCategoryCode:"Z",taxExemptionReasonCode:"VATEX-SA-35",taxExemptionReason:"Medicine",vatApplicable:false,priceIncludesVat:false};
beforeEach(()=>{vi.clearAllMocks();vi.mocked(prisma.company.findFirst).mockResolvedValue({id:"c"} as never);vi.mocked(prisma.item.findFirst).mockResolvedValue(original as never);});
describe("catalog tax persistence",()=>{
 it("stores bilingual names and explicit treatment on create",async()=>{
  const create=vi.fn().mockImplementation(({data})=>Promise.resolve(data));
  vi.mocked(prisma.$transaction).mockImplementation(((fn:any)=>fn({item:{create}})) as never);
  const result=await createItemWithComponents("t",{...original,vatApplicable:true});
  expect(result).toMatchObject({nameEn:"Item",priceIncludesVat:false,taxCategoryCode:"Z",vatApplicable:false,taxExemptionReasonCode:"VATEX-SA-35"});
 });
 it("does not reset tax or price basis when only a name is edited",async()=>{
  await updateItemWithValidation("t","i",{nameEn:"New name"});
  expect(prisma.item.update).toHaveBeenCalledWith({where:{id:"i"},data:{nameEn:"New name"}});
 });
 it("clears exemption fields when changing to standard rated",async()=>{
  await updateItemWithValidation("t","i",{taxCategoryCode:"S"});
  expect(prisma.item.update).toHaveBeenCalledWith({where:{id:"i"},data:expect.objectContaining({taxCategoryCode:"S",vatApplicable:true,taxExemptionReasonCode:null,taxExemptionReason:null})});
 });
 it("rejects mismatched reasons before writing",async()=>{
  await expect(updateItemWithValidation("t","i",{taxCategoryCode:"E"})).rejects.toThrow();
  expect(prisma.item.update).not.toHaveBeenCalled();
 });
});
