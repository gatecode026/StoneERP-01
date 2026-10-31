import { describe, it, expect } from 'vitest';
import { projectDoc, hiddenFields, assertWritable } from '@/lib/perm/engine';
import type { EffectivePerm } from '@/lib/perm/engine';

describe('Project Field-Level Permissions (Owner-only Client & Price)', () => {
  const sampleProject = {
    _id: 'proj_123',
    projectCode: 'PRJ-0001',
    name: 'Red 12*12"',
    clientName: 'Aman stone',
    stoneType: 'Mandana Red',
    price: 65,
    contractValue: 130000,
    balanceOrderAmount: 50000,
    status: 'In Progress',
  };

  const ownerPerm: Pick<EffectivePerm, 'fields'> & { isOwner: boolean } = {
    isOwner: true,
    fields: { money: 'write', cost: 'write', pii: 'write' },
  };

  const supervisorPerm: Pick<EffectivePerm, 'fields'> & { isOwner: boolean } = {
    isOwner: false,
    fields: { money: 'none', cost: 'none', pii: 'none' },
  };

  const managerPerm: Pick<EffectivePerm, 'fields'> & { isOwner: boolean } = {
    isOwner: false,
    fields: { money: 'write', cost: 'write', pii: 'write' },
  };

  it('owner sees clientName and price-related fields', () => {
    const doc = projectDoc(ownerPerm as any, 'projects', sampleProject);
    expect(doc?.clientName).toBe('Aman stone');
    expect(doc?.price).toBe(65);
    expect(doc?.contractValue).toBe(130000);
    expect(doc?.balanceOrderAmount).toBe(50000);
  });

  it('supervisor does NOT see clientName or price-related fields', () => {
    const doc = projectDoc(supervisorPerm as any, 'projects', sampleProject);
    expect(doc?.name).toBe('Red 12*12"');
    expect(doc?.projectCode).toBe('PRJ-0001');
    expect(doc?.clientName).toBeUndefined();
    expect(doc?.price).toBeUndefined();
    expect(doc?.contractValue).toBeUndefined();
    expect(doc?.balanceOrderAmount).toBeUndefined();
  });

  it('non-owner manager does NOT see clientName or price-related fields on projects', () => {
    const doc = projectDoc(managerPerm as any, 'projects', sampleProject);
    expect(doc?.name).toBe('Red 12*12"');
    expect(doc?.clientName).toBeUndefined();
    expect(doc?.price).toBeUndefined();
    expect(doc?.contractValue).toBeUndefined();
    expect(doc?.balanceOrderAmount).toBeUndefined();
  });

  it('hiddenFields marks clientName and price fields as hidden for non-owners', () => {
    const hidden = hiddenFields(supervisorPerm as any, 'projects');
    expect(hidden.has('clientName')).toBe(true);
    expect(hidden.has('price')).toBe(true);
    expect(hidden.has('contractValue')).toBe(true);
    expect(hidden.has('balanceOrderAmount')).toBe(true);

    const ownerHidden = hiddenFields(ownerPerm as any, 'projects');
    expect(ownerHidden.has('clientName')).toBe(false);
    expect(ownerHidden.has('price')).toBe(false);
    expect(ownerHidden.has('contractValue')).toBe(false);
  });

  it('assertWritable throws 403 when non-owner tries to change clientName or price', () => {
    expect(() => assertWritable(ownerPerm as any, 'projects', ['clientName', 'price'])).not.toThrow();
    expect(() => assertWritable(supervisorPerm as any, 'projects', ['clientName'])).toThrow(/Only an Owner/);
    expect(() => assertWritable(supervisorPerm as any, 'projects', ['price'])).toThrow(/Only an Owner/);
    expect(() => assertWritable(supervisorPerm as any, 'projects', ['contractValue'])).toThrow(/Only an Owner/);
    expect(() => assertWritable(supervisorPerm as any, 'projects', ['balanceOrderAmount'])).toThrow(/Only an Owner/);
  });

  it('Project mongoose model defines clientName field in its schema', async () => {
    const { Project } = await import('@/lib/models/projects');
    const p = Project.schema.path('clientName');
    expect(p).toBeDefined();
    expect(p.instance).toBe('String');
  });
});
