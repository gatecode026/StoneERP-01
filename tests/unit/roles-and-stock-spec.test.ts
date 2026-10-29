import { describe, it, expect } from 'vitest';
import { roleOfJob } from '@/lib/roles';
import { importSpec } from '@/lib/import/specs';
import { JOBS } from '@/lib/config';

describe('Roles and Job Mapping', () => {
  it('JOBS has only Supervisor, Operator, and Worker / Labour', () => {
    expect(JOBS).toEqual(['Supervisor', 'Operator', 'Worker / Labour']);
  });

  it('roleOfJob maps Supervisor, Operator, and Worker / Labour correctly', () => {
    expect(roleOfJob('Supervisor')).toBe('supervisor');
    expect(roleOfJob('supervisior')).toBe('supervisor');
    expect(roleOfJob('Operator')).toBe('operator');
    expect(roleOfJob('operator')).toBe('operator');
    expect(roleOfJob('Worker / Labour')).toBe('worker');
    expect(roleOfJob('Worker')).toBe('worker');
    expect(roleOfJob('Labour')).toBe('worker');
  });
});

describe('Stock Item Import Spec', () => {
  const spec = importSpec('stockitems')!;

  it('has visible template columns matching Name, Finish, Egdes, Thikness, Size (L), Size (W), Quntity, SQFT, Price', () => {
    const visible = spec.columns.filter((c) => !c.hiddenInTemplate).map((c) => c.label);
    expect(visible).toEqual([
      'Name',
      'Finish',
      'Egdes',
      'Thikness',
      'Size (L)',
      'Size (W)',
      'Quntity',
      'SQFT',
      'Price',
    ]);
  });

  it('shapes raw row data correctly including manual thickness and sqft opening balance', () => {
    const shaped = spec.shape!({
      name: 'Kotah Brown',
      finish: 'Honed',
      edges: 'Machine Cut',
      thickness: '20-25',
      sizeL: 600,
      sizeW: 600,
      pieces: 80,
      openingBalance: 310,
      price: 72,
    });

    expect(shaped).toMatchObject({
      name: 'Kotah Brown',
      finish: 'Honed',
      edges: 'Machine Cut',
      thickness: '20-25',
      sizeL: 600,
      sizeW: 600,
      size: '600x600',
      pieces: 80,
      openingBalance: 310,
      price: 72,
      sellRate: 72,
    });
  });

  it('generates distinct keys for same colour and finish when thickness or edges differ', () => {
    // Row 3: Slate Grey, Natural, 60x90, 25-35mm, M/c
    const row3Key = spec.keyOf!({
      name: 'Slate Grey',
      finish: 'Natural',
      sizeL: 60,
      sizeW: 90,
      thickness: '25-35mm',
      edges: 'M/c',
    });

    // Row 13: Slate Grey, Natural, 60x90, 22mm, empty
    const row13Key = spec.keyOf!({
      name: 'Slate Grey',
      finish: 'Natural',
      sizeL: 60,
      sizeW: 90,
      thickness: '22mm',
      edges: '',
    });

    expect(row3Key).not.toBe(row13Key);
    expect(row3Key).toBe('slategrey|natural|60x90|25-35mm|m/c');
    expect(row13Key).toBe('slategrey|natural|60x90|22mm|');

    // Also normalizes whitespace and multiplication symbol
    const rowWithCross = spec.keyOf!({
      name: 'Slate Grey ',
      finish: ' Natural',
      size: '60 × 90',
      thickness: '22 mm',
    });
    expect(rowWithCross).toBe('slategrey|natural|60x90|22mm|');
  });
});

