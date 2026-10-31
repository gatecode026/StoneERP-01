import { describe, it, expect } from 'vitest';
import { Employee } from '@/lib/models/people';
import { KINDS } from '@/lib/services/typeahead';
import { employees } from '@/lib/resources/people';

describe('Employee Operator Category & Deletion Configurations', () => {
  it('Employee model has operatorCategory field with Bridge Cutter & Block Cutter enum', () => {
    const p: any = Employee.schema.path('operatorCategory');
    expect(p).toBeDefined();
    expect(p.instance).toBe('String');
    expect(p.enumValues).toContain('Bridge Cutter');
    expect(p.enumValues).toContain('Block Cutter');
  });

  it('employees resource schema includes operatorCategory in listFields and filters', () => {
    expect(employees.listFields).toContain('operatorCategory');
    expect(employees.filters).toHaveProperty('operatorCategory');
  });

  it('typeahead service includes operatorCategory in employees select and filters', () => {
    const empKind = KINDS.employees;
    expect(empKind.select).toContain('operatorCategory');
    expect(empKind.filters).toHaveProperty('operatorCategory');
    expect(empKind.label({ name: 'Ramesh', job: 'Operator', operatorCategory: 'Bridge Cutter' })).toBe('Ramesh (Bridge Cutter)');
    expect(empKind.label({ name: 'Suresh', job: 'Operator' })).toBe('Suresh (Operator)');
  });
});
