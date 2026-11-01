import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({payrollRun:{findFirst:vi.fn(),update:vi.fn(),deleteMany:vi.fn()},attachment:{count:vi.fn()},$transaction:vi.fn(),employee:{findMany:vi.fn()},payrollComponent:{findMany:vi.fn()},leaveSettlement:{findMany:vi.fn()},payrollSettings:{findUnique:vi.fn()},employeePayrollComponent:{findMany:vi.fn()},hrAction:{findMany:vi.fn()},employeeAdvance:{findMany:vi.fn()}}));
vi.mock('../../lib/prisma',()=>({prisma:db}));
vi.mock('../../lib/journalPosting',()=>({createJournalEntryTx:vi.fn(),deleteJournalEntryTx:vi.fn(),assertValidUnlockPin:vi.fn(),writeUnpostAuditLogTx:vi.fn()}));
import { getPayrollRunRows, updatePayrollRunEmployees, deletePayrollRun } from './payrollRuns.service';
beforeEach(()=>vi.resetAllMocks());
describe('payroll draft scope and snapshots',()=>{
 it('changes only employee IDs preserving saved overrides',async()=>{
  const run={id:'run',tenantId:'t',companyId:'c',status:'draft',employeeIds:['a'],overrides:{a:{advance:750}}};
  db.payrollRun.findFirst.mockResolvedValue(run);db.employee.findMany.mockResolvedValue([{id:'a'},{id:'b'}]);
  db.payrollRun.update.mockImplementation(({data})=>({...run,...data}));
  const result=await updatePayrollRunEmployees('t','run',['a','b']);
  expect(result.overrides).toEqual(run.overrides);expect(db.payrollRun.update).toHaveBeenCalledWith({where:{id:'run'},data:{employeeIds:['a','b']}});
  expect(db.employee.findMany).toHaveBeenCalledWith({where:{id:{in:['a','b']},tenantId:'t',companyId:'c'}});
 });
 it('rejects scope changes on posted payroll',async()=>{db.payrollRun.findFirst.mockResolvedValue({status:'posted'});await expect(updatePayrollRunEmployees('t','run',['a'])).rejects.toThrow();expect(db.payrollRun.update).not.toHaveBeenCalled();});
 it('rejects employees outside this company',async()=>{db.payrollRun.findFirst.mockResolvedValue({status:'draft',companyId:'c'});db.employee.findMany.mockResolvedValue([]);await expect(updatePayrollRunEmployees('t','run',['outsider'])).rejects.toThrow();expect(db.payrollRun.update).not.toHaveBeenCalled();});
 it('reads a posted snapshot without recalculating changed employees or settings',async()=>{
  db.payrollRun.findFirst.mockResolvedValue({status:'posted',postedSnapshot:{components:[{id:'basic',name:'Basic',kind:'addition'}],rows:[{employeeId:'a',componentValues:{basic:4000},totalAdditions:4000,totalDeductions:390,net:3610}]}});
  const result=await getPayrollRunRows('t','run');expect(result.totals.net).toBe(3610);expect(db.employee.findMany).not.toHaveBeenCalled();expect(db.payrollSettings.findUnique).not.toHaveBeenCalled();
 });
 it('prevents a stale GOSI override from charging an exempt employee',async()=>{
  db.payrollRun.findFirst.mockResolvedValue({status:'draft',companyId:'c',month:'2026-10',employeeIds:['a'],overrides:{a:{gosi:999}}});
  db.payrollComponent.findMany.mockResolvedValue([{id:'basic',name:'Basic',kind:'addition',calcMethod:'fixed',sourceEmployeeField:'basicSalary',systemKey:'basic'}, {id:'gosi',name:'GOSI',kind:'deduction',calcMethod:'fixed',systemKey:'gosi'}]);
  db.employee.findMany.mockResolvedValue([{id:'a',name:'Synthetic',basicSalary:4000,housingAllowance:0,transportAllowance:0,otherAllowance:0,gosiApplicable:false}]);
  db.leaveSettlement.findMany.mockResolvedValue([]);db.payrollSettings.findUnique.mockResolvedValue(null);
  db.employeePayrollComponent.findMany.mockResolvedValue([{employeeId:'a',componentId:'basic'},{employeeId:'a',componentId:'gosi',fixedValue:999}]);db.hrAction.findMany.mockResolvedValue([]);db.employeeAdvance.findMany.mockResolvedValue([]);
  const result=await getPayrollRunRows('t','run');expect(result.totals.totalDeductions).toBe(0);expect(result.rows[0].componentValues.gosi).toBeUndefined();expect(result.totals.net).toBe(4000);
 });
});

describe('draft deletion guards',()=>{
 beforeEach(()=>{db.$transaction.mockImplementation(fn=>fn(db));db.attachment.count.mockResolvedValue(0);});
 it('deletes only the tenant draft with no journal or advance deductions',async()=>{
  db.payrollRun.findFirst.mockResolvedValue({status:'draft',journalEntryId:null});db.payrollRun.deleteMany.mockResolvedValue({count:1});
  await expect(deletePayrollRun('t','run')).resolves.toEqual({deleted:true});
  expect(db.payrollRun.findFirst).toHaveBeenCalledWith({where:{id:'run',tenantId:'t'}});
  expect(db.payrollRun.deleteMany).toHaveBeenCalledWith({where:{id:'run',tenantId:'t',status:'draft',journalEntryId:null,advanceDeductions:{none:{}}}});
 });
 it.each([{status:'posted'},{status:'draft',journalEntryId:'journal'}])('rejects a posted or linked payroll',async run=>{
  db.payrollRun.findFirst.mockResolvedValue(run);await expect(deletePayrollRun('t','run')).rejects.toThrow();expect(db.payrollRun.deleteMany).not.toHaveBeenCalled();
 });
 it('preserves drafts with attachments',async()=>{
  db.payrollRun.findFirst.mockResolvedValue({status:'draft'});db.attachment.count.mockResolvedValue(1);
  await expect(deletePayrollRun('t','run')).rejects.toThrow();expect(db.payrollRun.deleteMany).not.toHaveBeenCalled();
 });
 it('does not report success when status changed concurrently',async()=>{
  db.payrollRun.findFirst.mockResolvedValue({status:'draft'});db.payrollRun.deleteMany.mockResolvedValue({count:0});
  await expect(deletePayrollRun('t','run')).rejects.toThrow();
 });
 it('rejects missing or other-tenant payroll',async()=>{
  db.payrollRun.findFirst.mockResolvedValue(null);await expect(deletePayrollRun('t','run')).rejects.toThrow();expect(db.payrollRun.deleteMany).not.toHaveBeenCalled();
 });
});
