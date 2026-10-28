import { describe, it, expect } from 'vitest';
import { applyEmployeeGosi, employeeGosiAmount } from './employeeGosi';
import { computeEmployeePayroll, PayrollComponentLike } from './payrollEngine';
import { createEmployeeSchema, updateEmployeeSchema, importEmployeesSchema } from '../modules/employees/employees.schemas';

const base = { basicSalary: 4000, housingAllowance: 0, transportAllowance: 0, otherAllowance: 0, gosiApplicable: true, gosiEmployeeRate: 9.75 };
const component = (id:string,kind:'addition'|'deduction',systemKey?:string): PayrollComponentLike => ({id,kind,systemKey,calcMethod:'fixed',formula:null,adjustmentUnitBasis:null,sourceEmployeeField:id==='basic'?'basicSalary':null,prorateOnPartialMonth:false});
const settings={standardHoursPerMonth:240,standardDaysPerMonth:30};
describe('employee GOSI',()=>{
 it.each([[9.75,390],[10.75,430]])('rate %s deducts %s', (rate, expected)=>expect(employeeGosiAmount({...base,gosiEmployeeRate:rate})).toBe(expected));
 it('exempt wins over stale fixed amount',()=>expect(employeeGosiAmount({...base,gosiApplicable:false,gosiAmount:500})).toBe(0));
 it('rounds to two decimals and includes housing',()=>expect(employeeGosiAmount({...base,basicSalary:4000.05,housingAllowance:500.05})).toBe(438.76));
 it.each(['legacy:gosi','stored-component-id'])('uses employee rate for %s and keeps employer component independent',id=>{
  const components=[component('basic','addition'),component(id,'deduction',id==='legacy:gosi'?undefined:'gosi'),component('employer','deduction')];
  const fixed=new Map([['employer',100],[id,999]]), adjustments=new Map([[id,999]]);
  const selected=applyEmployeeGosi(base,components,fixed,adjustments);
  const result=computeEmployeePayroll({employee:base,components:selected,fixedValues:fixed,monthlyAdjustments:adjustments,settings,fullyOnLeave:false,prorationFactor:null});
  expect(result.values.get(id)).toBe(390);expect(result.values.get('employer')).toBe(100);expect(result.net).toBe(3510);
  expect(applyEmployeeGosi({...base,gosiApplicable:false},components,fixed,adjustments).map(c=>c.id)).toEqual(['basic','employer']);
 });
 it('reconciles a synthetic fourteen employee payroll',()=>{
  const salaries=[4000,3500,3000,3000,2500,2500,2000,2000,1740,3000,17000,4000,4000,4000];
  const gross=salaries.reduce((a,b)=>a+b,0);const gosi=salaries.reduce((sum,basicSalary,i)=>sum+employeeGosiAmount({...base,basicSalary,gosiApplicable:i>=11}),0);
  expect(gross).toBe(56240);expect(gosi).toBe(1170);expect(gross-gosi-2250-4830).toBe(47990);
 });
});
describe('employee input',()=>{
 const valid={companyId:'company',name:'Test employee',hireDate:'2026-01-01',basicSalary:4000};
 it('missing import eligibility does not assume Saudi or GOSI',()=>{const e=importEmployeesSchema.parse({companyId:'company',rows:[valid]}).rows[0];expect(e.gosiApplicable).toBe(false);expect(e.nationality).toBeUndefined();});
 it('requires explicit rate when enabling on creation',()=>{expect(createEmployeeSchema.safeParse({...valid,gosiApplicable:true}).success).toBe(false);expect(createEmployeeSchema.safeParse({...valid,gosiApplicable:true,gosiEmployeeRate:10.75}).success).toBe(true);});
 it('accepts optional null text and dates without epoch coercion',()=>{const e=updateEmployeeSchema.parse({phone:null,employeeNumber:null,personalEmail:null,contractEnd:null,dateOfBirth:null});expect(e.phone).toBeNull();expect(e.contractEnd).toBeNull();expect(e.dateOfBirth).toBeNull();expect(e).not.toHaveProperty('gosiApplicable');});
 it('rejects unsupported rates',()=>expect(updateEmployeeSchema.safeParse({gosiEmployeeRate:15}).success).toBe(false));
});
