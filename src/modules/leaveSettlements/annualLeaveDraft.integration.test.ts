import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import { createApp } from "../../app";
import { register } from "../auth/auth.service";
guardAgainstUnsafeIntegrationTestDatabase();
let server: Server, base = "", token = "", tenantId = "", companyId = "", employeeId = "", otherTenant = "", otherToken = "", otherCompany = "";
async function call(method: string, path: string, body?: unknown, auth = token) {
  const response = await fetch(`${base}/api${path}`, { method, headers: { authorization: `Bearer ${auth}`, "content-type":"application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
}
const input = () => ({ companyId, employeeId, leaveStartDate:"2026-11-16", balanceMode:"all", salaryMode:"until_leave" });
describe("annual leave review drafts through the actual HTTP handlers and payroll engine",()=>{
  beforeAll(async()=>{
    server=createApp().listen(0);await new Promise<void>(resolve=>server.once("listening",resolve));base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for(const other of [false,true]){
      const r=await register({ tenantName:`annual-review-${Date.now()}-${other}`, businessActivity:"manufacturing",name:"Owner",email:`annual-review-${Date.now()}-${other}@example.com`,password:"Str0ng-Pass!" });
      const company=await prisma.company.findFirstOrThrow({where:{tenantId:r.tenant.id}});
      if(other){otherTenant=r.tenant.id;otherToken=r.accessToken;otherCompany=company.id;}else{tenantId=r.tenant.id;token=r.accessToken;companyId=company.id;}
    }
    const employee=await call("POST","/employees",{companyId,name:"Leave review employee",hireDate:"2025-01-01",basicSalary:3000,housingAllowance:600,advances:200,otherDeductions:100,gosiApplicable:false,jobTitle:"Technician",department:"Operations"});
    expect(employee.status).toBe(201);employeeId=employee.body.id;
  },60000);
  afterAll(async()=>{
    if(tenantId)await prisma.tenant.delete({where:{id:tenantId}});
    if(otherTenant)await prisma.tenant.delete({where:{id:otherTenant}});
    if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));
  });
  it("prorates earnings but keeps monthly deductions, without employee GOSI",async()=>{
    const r=await call("POST","/leave-settlements/annual-preview",input());
    expect(r.status).toBe(200);
    expect(r.body.salary).toMatchObject({days:15,additions:1800,deductions:300,net:1500});
    expect(r.body.employee).toMatchObject({hireDate:"2025-01-01",jobTitle:"Technician",department:"Operations"});
  });
  it("uses the selected payroll month's actual manual overrides",async()=>{
    const run=await call("POST","/payroll-runs",{companyId,month:"2026-10",employeeIds:[employeeId]});expect(run.status).toBe(201);
    expect((await call("PUT",`/payroll-runs/${run.body.id}/overrides/${employeeId}`,{"legacy:advance":750,"legacy:otherDed":100})).status).toBe(200);
    const r=await call("POST","/leave-settlements/annual-preview",{...input(),salaryMonth:"2026-10"});
    expect(r.status).toBe(200);expect(r.body.salary).toMatchObject({additions:3600,deductions:850,net:2750});
  });
  it("saves server-calculated immutable printable snapshots without journals, leave consumption or changing status",async()=>{
    const before=await prisma.journalEntry.count({where:{tenantId}});
    const request={...input(),otherAdditions:150,additionsReason:"Travel allowance",ticketAmount:800};
    const preview=await call("POST","/leave-settlements/annual-preview",request);
    const saved=await call("POST","/leave-settlements/annual-drafts",{...request,net:1,snapshot:{net:1}});
    expect(saved.status).toBe(201);expect(saved.body.snapshot).toEqual(preview.body);
    expect(saved.body.snapshot.request.additionsReason).toBe("Travel allowance");
    expect(await prisma.journalEntry.count({where:{tenantId}})).toBe(before);
    expect(await prisma.leaveSettlement.count({where:{tenantId}})).toBe(0);
    expect((await prisma.employee.findUniqueOrThrow({where:{id:employeeId}})).leaveStatus).toBe("active");
    const list=await call("GET",`/leave-settlements/annual-drafts?companyId=${companyId}`);
    expect(list.status).toBe(200);expect(list.body[0].snapshot).toEqual(preview.body);
  });
  it("prints English job title, department and payroll line names from the records' English names",async()=>{
    expect((await call("POST","/job-titles",{name:"فني تشغيل",nameEn:"Operations technician"})).status).toBe(201);
    expect((await call("POST","/departments",{name:"التشغيل",nameEn:"Operations dept",companyId})).status).toBe(201);
    const emp=await call("POST","/employees",{companyId,name:"English print employee",hireDate:"2025-09-28",basicSalary:2300,gosiApplicable:false,jobTitle:"فني تشغيل",department:"التشغيل"});
    expect(emp.status).toBe(201);
    const r=await call("POST","/leave-settlements/annual-preview",{...input(),employeeId:emp.body.id,leaveStartDate:"2026-11-13"});
    expect(r.status).toBe(200);
    expect(r.body.employee).toMatchObject({jobTitle:"فني تشغيل",jobTitleEn:"Operations technician",department:"التشغيل",departmentEn:"Operations dept"});
    expect(r.body.salary.lines.find((l:{systemKey:string|null})=>l.systemKey==="basic")).toMatchObject({amount:920});
    expect(r.body.balance).toMatchObject({throughDate:"2026-11-13",payDays:r.body.balance.availableDays,remainingDays:0});
    const year=await call("POST","/leave-settlements/annual-preview",{...input(),employeeId:emp.body.id,leaveStartDate:"2026-11-13",balanceMode:"contract_year"});
    expect(year.body.balance).toMatchObject({throughDate:"2026-09-28",payDays:21});
  });
  it("lets only the draft's preparer edit (recomputed server-side) or delete it, without journals",async()=>{
    const before=await prisma.journalEntry.count({where:{tenantId}});
    const created=await call("POST","/leave-settlements/annual-drafts",{...input(),balanceMode:"contract_year"});
    expect(created.status).toBe(201);
    const edited=await call("PUT",`/leave-settlements/annual-drafts/${created.body.id}`,{...input(),balanceMode:"all",snapshot:{net:1}});
    expect(edited.status).toBe(200);
    const fresh=await call("POST","/leave-settlements/annual-preview",{...input(),balanceMode:"all"});
    expect(edited.body.snapshot).toEqual(fresh.body);
    expect((await call("PUT",`/leave-settlements/annual-drafts/${created.body.id}`,{...input(),companyId:otherCompany},otherToken)).status).toBeGreaterThanOrEqual(400);
    expect((await call("DELETE",`/leave-settlements/annual-drafts/${created.body.id}`,undefined,otherToken)).status).toBeGreaterThanOrEqual(400);
    // مسودة من مستخدم آخر داخل المستأجر نفسه: لا ينتجها مسار التسجيل بسهولة هنا، فننقل معدّها عمداً إلى معرّف آخر.
    await prisma.annualLeaveDraft.update({where:{id:created.body.id},data:{createdBy:"another-preparer"}});
    expect((await call("DELETE",`/leave-settlements/annual-drafts/${created.body.id}`)).status).toBe(403);
    expect((await call("PUT",`/leave-settlements/annual-drafts/${created.body.id}`,input())).status).toBe(403);
    const ownerId=(await prisma.user.findFirstOrThrow({where:{tenantId}})).id;
    await prisma.annualLeaveDraft.update({where:{id:created.body.id},data:{createdBy:ownerId}});
    expect((await call("DELETE",`/leave-settlements/annual-drafts/${created.body.id}`)).status).toBe(200);
    expect(await prisma.annualLeaveDraft.findUnique({where:{id:created.body.id}})).toBeNull();
    expect(await prisma.journalEntry.count({where:{tenantId}})).toBe(before);
  });
  it("never includes another tenant or company employee",async()=>{
    expect((await call("POST","/leave-settlements/annual-preview",{...input(),companyId:otherCompany})).status).toBeGreaterThanOrEqual(400);
    const r=await call("GET",`/leave-settlements/annual-drafts?companyId=${companyId}`,undefined,otherToken);
    expect(r.status===403 || (r.status===200 && r.body.length===0)).toBe(true);
    expect((await call("POST","/leave-settlements/annual-drafts",input(),otherToken)).status).toBeGreaterThanOrEqual(400);
  });
  it("keeps the unselected balance for the next leave and does not double count opening accrual",async()=>{
    const r=await call("POST","/leave-settlements/annual-preview",{...input(),openingDate:"2026-01-01",openingDays:5,openingAmount:500,balanceMode:"through_date",balanceThroughDate:"2026-01-01",salaryMode:"none"});
    expect(r.status).toBe(200);expect(r.body.balance).toMatchObject({carryDays:5,carryAmount:500,payDays:5,payAmount:500});
    expect(r.body.balance.remainingDays).toBeGreaterThan(0);
    expect(r.body.balance.payAmount+r.body.balance.remainingAmount).toBeCloseTo(r.body.balance.availableAmount,2);
  });
});
