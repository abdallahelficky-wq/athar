import { PayrollComponentLike } from './payrollEngine';

export interface EmployeeGosi {
  gosiApplicable: boolean;
  gosiEmployeeRate?: unknown;
  gosiAmount?: unknown;
  basicSalary: unknown;
  housingAllowance: unknown;
}

// Employee withholding only. Employer contributions are separate components.
export function employeeGosiAmount(employee: EmployeeGosi): number {
  if (!employee.gosiApplicable) return 0;
  if (employee.gosiAmount != null) return Number(employee.gosiAmount);
  const rate = Number(employee.gosiEmployeeRate ?? 9.75); // pre-migration compatibility
  if (rate !== 9.75 && rate !== 10.75) throw new Error('اختر نسبة خصم تأمينات الموظف: 9.75% أو 10.75%');
  return Math.round((Number(employee.basicSalary) + Number(employee.housingAllowance)) * rate + Number.EPSILON) / 100;
}

export function isEmployeeGosi(component: PayrollComponentLike): boolean {
  return component.systemKey === 'gosi' || component.id === 'legacy:gosi';
}

export function applyEmployeeGosi<T extends PayrollComponentLike>(employee: EmployeeGosi, components: T[], fixed: Map<string, number>, adjustments: Map<string, number>): T[] {
  return components.filter(component => {
    if (!isEmployeeGosi(component)) return true;
    adjustments.delete(component.id);
    fixed.set(component.id, employeeGosiAmount(employee));
    return employee.gosiApplicable;
  });
}
