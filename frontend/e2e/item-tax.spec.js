import { test, expect } from "@playwright/test";
test("edit bilingual catalog fields, save zero-rate basis and reopen", async ({page}) => {
 let item={id:"item1",code:"1",name:"منظف",type:"service",salePrice:100,vatApplicable:true,revenueAccountId:"rev"}; let saved;
 await page.route("http://localhost:4000/api/**",async route=>{
  const path=new URL(route.request().url()).pathname; let data=[];
  if(path.endsWith("/items/item1") && route.request().method()==="PATCH"){saved=route.request().postDataJSON();item={...item,...saved};data=item;}
  else if(path.endsWith("/items")) data=[item];
  else if(path.endsWith("/accounts")) data=[{id:"rev",name:"المبيعات",type:"revenue",isPosting:true}];
  await route.fulfill({json:data});
 });
 await page.goto("/e2e/fixtures/item-tax.html");
 await page.locator(".items-table").getByRole("button",{name:"تعديل",exact:true}).click();
 const form=page.locator(".items-form-panel");
 await form.getByLabel("اسم الصنف بالإنجليزية").fill("Cleaner");
 await form.getByLabel("المعاملة الضريبية").selectOption("Z");
 await form.getByLabel("سبب الإعفاء أو نسبة الصفر").selectOption("VATEX-SA-35");
 await form.getByLabel("السعر المدخل").selectOption("false");
 await form.getByRole("button",{name:"حفظ التعديلات"}).click();
 await expect(form).toHaveCount(0);
 expect(saved).toMatchObject({name:"منظف",nameEn:"Cleaner",taxCategoryCode:"Z",vatApplicable:false,priceIncludesVat:false,taxExemptionReasonCode:"VATEX-SA-35"});
 await page.locator(".items-table").getByRole("button",{name:"تعديل",exact:true}).click();
 await expect(form.getByLabel("اسم الصنف بالإنجليزية")).toHaveValue("Cleaner");
 await expect(form.getByLabel("المعاملة الضريبية")).toHaveValue("Z");
 await expect(form.getByLabel("السعر المدخل")).toHaveValue("false");
 await page.screenshot({path:"test-results/item-tax-form.png",fullPage:true});
});
test("English search selects original price basis and calculates 15%", async ({page})=>{
 await page.route("http://localhost:4000/api/**",route=>route.fulfill({json:[]}));
 await page.goto("/e2e/fixtures/item-tax.html");
 const invoice=page.getByTestId("invoice");
 await invoice.locator(".item-combo-cell input").first().fill("Cleaner");
 await invoice.locator(".item-combo-option").filter({hasText:"منظف / Cleaner"}).click();
 await expect(invoice.locator(".item-combo-cell input").first()).toHaveValue("منظف / Cleaner");
 await expect(invoice.locator('input[type="checkbox"]')).not.toBeChecked();
 await expect(invoice.locator(".preview-row.net-row")).toContainText("115.00");
 await invoice.getByLabel("المعاملة الضريبية").selectOption("E");
 await invoice.getByLabel("سبب الإعفاء أو نسبة الصفر").selectOption("VATEX-SA-29");
 await expect(invoice.locator(".preview-row.net-row")).toContainText("100.00");
});
