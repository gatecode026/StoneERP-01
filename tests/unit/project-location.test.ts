import { describe, it, expect } from 'vitest';
import { INDIAN_STATES, COUNTRIES } from '@/lib/config';
import { importSpec } from '@/lib/import/specs';
import { projects } from '@/lib/resources/projects';

describe('Project Location Configuration', () => {
  it('exports INDIAN_STATES with all major states and Union Territories', () => {
    expect(Array.isArray(INDIAN_STATES)).toBe(true);
    expect(INDIAN_STATES).toContain('Rajasthan');
    expect(INDIAN_STATES).toContain('Gujarat');
    expect(INDIAN_STATES).toContain('Maharashtra');
    expect(INDIAN_STATES).toContain('Delhi');
    expect(INDIAN_STATES).toContain('Other');
  });

  it('exports COUNTRIES with India as primary option', () => {
    expect(Array.isArray(COUNTRIES)).toBe(true);
    expect(COUNTRIES[0]).toBe('India');
    expect(COUNTRIES).toContain('United Arab Emirates');
    expect(COUNTRIES).toContain('United States');
    expect(COUNTRIES).toContain('United Kingdom');
    expect(COUNTRIES).toContain('Other');
  });
});

describe('Projects Resource Specification', () => {
  it('includes place, state, and country in listFields, searchFields, and filters', () => {
    expect(projects.listFields).toContain('place');
    expect(projects.listFields).toContain('state');
    expect(projects.listFields).toContain('country');

    expect(projects.searchFields).toContain('place');
    expect(projects.searchFields).toContain('state');
    expect(projects.searchFields).toContain('country');

    expect(projects.filters).toHaveProperty('state');
    expect(projects.filters).toHaveProperty('country');
  });

  const mockCtx: any = { session: undefined };
  const mockAuth: any = { role: 'owner', user: { _id: 'u1' } };

  it('prepareCreate lifecycle assigns default state and country when not specified', async () => {
    const input = {
      projectCode: 'PRJ-0001',
      name: 'Resort Wall Cladding',
      place: 'Bijoliya',
    };
    const prepared = await projects.lifecycle!.prepareCreate!(mockCtx, input, mockAuth);
    expect(prepared.place).toBe('Bijoliya');
    expect(prepared.state).toBe('Rajasthan');
    expect(prepared.country).toBe('India');
  });

  it('prepareCreate retains custom state and country if provided', async () => {
    const input = {
      projectCode: 'PRJ-0002',
      name: 'Dubai Luxury Villa',
      place: 'Palm Jumeirah',
      state: 'Dubai',
      country: 'United Arab Emirates',
    };
    const prepared = await projects.lifecycle!.prepareCreate!(mockCtx, input, mockAuth);
    expect(prepared.place).toBe('Palm Jumeirah');
    expect(prepared.state).toBe('Dubai');
    expect(prepared.country).toBe('United Arab Emirates');
  });

  it('validates place, state, and country in create schema', () => {
    const valid = projects.create!.safeParse({
      name: 'Test Project',
      place: 'Kishangarh',
      state: 'Rajasthan',
      country: 'India',
    });
    expect(valid.success).toBe(true);
  });
});

describe('Projects Import Spec', () => {
  const spec = importSpec('projects')!;

  it('has columns for place, state, and country', () => {
    const colKeys = spec.columns.map((c) => c.key);
    expect(colKeys).toContain('place');
    expect(colKeys).toContain('state');
    expect(colKeys).toContain('country');
  });

  it('shapes raw row data with place, state, and country', () => {
    const shaped = spec.shape!({
      partyName: 'ABC Stones Ltd',
      place: 'Bijoliya Yard',
      state: 'Rajasthan',
      country: 'India',
      orderNo: 'SO-200',
    });

    expect(shaped).toMatchObject({
      place: 'Bijoliya Yard',
      state: 'Rajasthan',
      country: 'India',
      clientName: 'ABC Stones Ltd',
      orderNo: 'SO-200',
    });
  });

  it('defaults state to Rajasthan and country to India when omitted', () => {
    const shaped = spec.shape!({
      partyName: 'XYZ Builders',
      place: 'Jaipur Depot',
    });

    expect(shaped.place).toBe('Jaipur Depot');
    expect(shaped.state).toBe('Rajasthan');
    expect(shaped.country).toBe('India');
  });

  it('backwards compatibility: falls back to dispatchFrom or site for place', () => {
    const shaped = spec.shape!({
      partyName: 'Legacy Order',
      dispatchFrom: 'Bijoliya Mine',
    });

    expect(shaped.place).toBe('Bijoliya Mine');
  });
});
