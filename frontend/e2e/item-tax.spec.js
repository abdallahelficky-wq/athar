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

test("purchase item exemption and zero rate suppress VAT for 90 x 760", async ({page}) => {
 await page.route("http://localhost:4000/api/**",route=>route.fulfill({json:[]}));
 await page.goto("/e2e/fixtures/item-tax.html");
 const form=page.getByTestId("purchase");
 await form.locator(".item-combo-cell input").first().fill("Scrap");
 await form.locator(".item-combo-option").click();
 await form.locator('input[type="number"]').nth(0).fill("90");
 await expect(form.getByLabel("المعاملة الضريبية")).toHaveValue("E");
 await expect(form.locator(".net-row")).toContainText("68,400.00");
 await form.getByLabel("المعاملة الضريبية").selectOption("Z");
 await expect(form.locator(".net-row")).toContainText("68,400.00");
 await form.getByLabel("المعاملة الضريبية").selectOption("S");
 await expect(form.locator(".net-row")).toContainText("78,660.00");
});

test("purchase modal saves zero rate without asking for reasons", async ({page}) => {
 let payload;
 await page.route("http://localhost:4000/api/**",async route=>{
  const path=new URL(route.request().url()).pathname; let data=[];
  if(path.endsWith("/suppliers")) data=[{id:"supplier",name:"Supplier"}];
  if(path.endsWith("/items")) data=[{id:"scrap",code:"SC001",name:"Scrap",type:"non_stock",lastPurchasePrice:760,taxCategoryCode:"S"}];
  if(path.endsWith("/purchase-invoices") && route.request().method()==="POST"){payload=route.request().postDataJSON();data={id:"new"};}
  await route.fulfill({json:data});
 });
 await page.goto("/e2e/fixtures/item-tax.html");
 await expect(page.getByRole("dialog")).toHaveCount(0);
 await page.getByRole("button",{name:"إضافة فاتورة مشتريات",exact:true}).click();
 const modal=page.getByRole("dialog");
 await expect(modal).toBeVisible();
 await modal.locator(".item-combo-cell input").first().fill("Scrap");
 await modal.locator(".item-combo-option").click();
 await modal.getByLabel("المعاملة الضريبية").selectOption("Z");
 await expect(modal.getByText("سبب الإعفاء أو نسبة الصفر")).toHaveCount(0);
 await modal.getByRole("button",{name:"حفظ وترحيل الفاتورة"}).click();
 await expect(modal).toHaveCount(0);
 expect(payload.lines[0]).toMatchObject({taxCategoryCode:"Z",vatApplicable:false,taxExemptionReasonCode:null});
 await page.getByRole("button",{name:"إضافة فاتورة مشتريات",exact:true}).click();
 await page.keyboard.press("Escape");
 await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("supplier modal and combined purchase filters", async ({page})=>{
 let suppliers=[{id:"s1",name:"Alpha",city:"Riyadh",phone:"055123",vatNumber:"3001",paymentTerms:"نقدي"},{id:"s2",name:"Beta",city:"Jeddah",paymentTerms:"آجل 30 يوم"}];
 const invoices=[{id:"i1",invoiceNumber:"PINV-1",supplierId:"s1",supplier:suppliers[0],status:"posted",date:"2026-09-01",grandTotal:100},{id:"i2",invoiceNumber:"PINV-2",supplierId:"s2",supplier:suppliers[1],status:"draft",date:"2026-09-28",grandTotal:200}];
 await page.route("http://localhost:4000/api/**",async route=>{const path=new URL(route.request().url()).pathname;let data=[];
 if(path.endsWith("/suppliers")&&route.request().method()==="POST"){const body=route.request().postDataJSON();suppliers.push({...body,id:"s3"});data=suppliers[2];}
 else if(path.endsWith("/suppliers/s1")&&route.request().method()==="PATCH"){suppliers[0]={...suppliers[0],...route.request().postDataJSON()};data=suppliers[0];}
 else if(path.endsWith("/suppliers"))data=suppliers;
 else if(path.endsWith("/purchase-invoices"))data=invoices;
 await route.fulfill({json:data});});
 await page.goto("/e2e/fixtures/purchase-management.html");
 const list=page.getByTestId("suppliers");const purchases=page.getByTestId("purchases");
 await expect(page.getByRole("dialog")).toHaveCount(0);
 await list.getByLabel("بحث",{exact:true}).fill("055123");
 await expect(list.locator("tbody tr")).toHaveCount(1);
 await expect(list.locator("tbody")).toContainText("Alpha");
 await list.getByLabel("المدينة",{exact:true}).selectOption("Jeddah");
 await expect(list.locator("tbody")).toContainText("لا توجد نتائج مطابقة");
 await list.getByRole("button",{name:"مسح الفلاتر"}).click();
 await expect(list.locator("tbody tr")).toHaveCount(2);
 await list.getByRole("button",{name:"تعديل",exact:true}).first().click();
 await page.getByRole("dialog").getByLabel("اسم المورد",{exact:true}).fill("Alpha updated");
 await page.getByRole("dialog").getByRole("button",{name:"حفظ التعديلات"}).click();
 await expect(page.getByRole("dialog")).toHaveCount(0);
 await expect(list.locator("tbody")).toContainText("Alpha updated");
 await list.getByRole("button",{name:"إضافة مورد",exact:true}).click();
 await page.getByRole("dialog").getByLabel("اسم المورد",{exact:true}).fill("Gamma");
 await page.getByRole("dialog").getByRole("button",{name:"حفظ بيانات المورد"}).click();
 await expect(list.locator("tbody tr")).toHaveCount(3);
 await purchases.getByLabel("المورد",{exact:true}).selectOption("s2");
 await purchases.getByLabel("الحالة",{exact:true}).selectOption("draft");
 await purchases.getByLabel("من تاريخ",{exact:true}).fill("2026-09-28");
 await purchases.getByLabel("إلى تاريخ",{exact:true}).fill("2026-09-28");
 await expect(purchases.locator("tbody tr")).toHaveCount(1);
 await expect(purchases.locator("tbody")).toContainText("PINV-2");
 await purchases.getByLabel("بحث",{exact:true}).fill("PINV-1");
 await expect(purchases.locator("tbody")).toContainText("لا توجد نتائج مطابقة");
 await purchases.getByRole("button",{name:"مسح الفلاتر"}).click();
 await expect(purchases.locator("tbody tr")).toHaveCount(2);
});
