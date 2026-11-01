import { test, expect } from "@playwright/test";
let calls;
test.beforeEach(async ({page})=>{
 calls=[];
 const runs=[{id:"draft",month:"2026-10",status:"draft",employeeIds:["e1"]},{id:"posted",month:"2026-09",status:"posted",employeeIds:["e1"]}];
 await page.route("http://localhost:4000/api/**",async route=>{
 const u=new URL(route.request().url()),p=u.pathname,m=route.request().method(); let data={};
 if(m!=="GET")calls.push({p,m});
 if(p.endsWith("/payroll-runs"))data=runs.filter(r=>!u.searchParams.get("month")||r.month===u.searchParams.get("month"));
 else if(p.endsWith("/employees"))data=[{id:"e1",name:"موظف تجريبي"}];
 else if(p.endsWith("/rows"))data={columns:[],rows:[{employeeId:"e1",employeeName:"موظف تجريبي",componentValues:{},net:100,totalAdditions:100,totalDeductions:0}],totals:{byComponent:{},net:100,totalAdditions:100,totalDeductions:0}};
 else if(p.includes("attachments"))data=[];
 if(m==="DELETE")data={deleted:true};
 await route.fulfill({json:data});
 });
 await page.goto("/e2e/fixtures/payroll-dialogs.html");
 await expect(page.getByRole("button",{name:"2026-10",exact:true})).toBeVisible();
});
test("draft opens in dialog and cancellation never deletes",async({page})=>{
 await expect(page.getByRole("dialog")).toHaveCount(0);
 await page.getByRole("button",{name:"2026-10",exact:true}).click();
 const dialog=page.getByRole("dialog");await expect(dialog.getByText("موظف تجريبي",{exact:true})).toBeVisible();
 page.once("dialog",d=>d.dismiss());await dialog.getByRole("button",{name:"حذف المسودة",exact:true}).click();
 expect(calls).toEqual([]);await expect(dialog).toBeVisible();
 await page.keyboard.press("Escape");await expect(dialog).toHaveCount(0);
});
test("posted payroll has print and unpost but no edit or delete",async({page})=>{
 await page.getByRole("button",{name:"2026-09",exact:true}).click();
 const dialog=page.getByRole("dialog");await expect(dialog.getByText("موظف تجريبي",{exact:true})).toBeVisible();
 await expect(dialog.getByRole("button",{name:"حذف المسودة",exact:true})).toHaveCount(0);
 await expect(dialog.getByRole("button",{name:"تعديل موظفي المسودة"})).toHaveCount(0);
 await dialog.getByRole("button",{name:/طباعة/}).click();await expect(page.locator(".payroll-report")).toBeVisible();
 await page.emulateMedia({media:"print"});await expect(page.locator(".hr-dialog-overlay")).toBeHidden();await expect(page.locator(".payroll-report")).toBeVisible();
 expect(calls).toEqual([]);
});
test("confirmed draft deletion uses its scoped endpoint",async({page})=>{
 await page.getByRole("button",{name:"2026-10",exact:true}).click();const dialog=page.getByRole("dialog");
 await expect(dialog.getByText("موظف تجريبي",{exact:true})).toBeVisible();page.once("dialog",d=>d.accept());
 await dialog.getByRole("button",{name:"حذف المسودة",exact:true}).click();await expect(dialog).toHaveCount(0);
 expect(calls).toEqual([{p:"/api/payroll-runs/draft",m:"DELETE"}]);
});