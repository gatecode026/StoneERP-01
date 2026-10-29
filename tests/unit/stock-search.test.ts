import { describe, it, expect } from 'vitest';
import { buildFilter, type ListQuery } from '@/lib/api/query';
import { stockitems } from '@/lib/resources/stock';

describe('Stock Search: Colour Name & Finish', () => {
  const baseQuery: Omit<ListQuery, 'q'> = {
    limit: 25,
    sortField: 'name',
    sortDir: 1,
    match: {},
    includeVoid: false,
    count: false,
    select: ['name', 'finish', 'balance'],
    extra: [],
  };

  it('builds multi-token cross-field search filter when searching colour name and finish (e.g. "Rajgreen Polish")', () => {
    const lq: ListQuery = { ...baseQuery, q: 'Rajgreen Polish' };
    const filter: any = buildFilter(lq, stockitems, {});

    expect(filter).toBeDefined();
    expect(filter.$and).toBeDefined();

    // Should include isVoid: false
    const voidClause = filter.$and.find((c: any) => c.isVoid === false);
    expect(voidClause).toBeDefined();

    // Should include search clause with both whole-phrase match and multi-word token $and
    const searchClause = filter.$and.find((c: any) => Array.isArray(c.$or));
    expect(searchClause).toBeDefined();

    // Check token $and inside $or
    const tokenAndClause = searchClause.$or.find((item: any) => Array.isArray(item.$and));
    expect(tokenAndClause).toBeDefined();
    expect(tokenAndClause.$and).toHaveLength(2); // "Rajgreen" and "Polish"

    // Token 1 ("Rajgreen") should check searchFields (name, finish, colourFinish, etc.)
    const rajgreenClause = tokenAndClause.$and[0];
    expect(rajgreenClause.$or.some((f: any) => f.name instanceof RegExp && f.name.test('Rajgreen'))).toBe(true);

    // Token 2 ("Polish") should check searchFields (name, finish, colourFinish, etc.)
    const polishClause = tokenAndClause.$and[1];
    expect(polishClause.$or.some((f: any) => f.finish instanceof RegExp && f.finish.test('Polish'))).toBe(true);
  });

  it('supports single-term search for colour only or finish only', () => {
    const lqColour: ListQuery = { ...baseQuery, q: 'Rajgreen' };
    const filterColour: any = buildFilter(lqColour, stockitems, {});
    const searchColour = filterColour.$and.find((c: any) => Array.isArray(c.$or));
    expect(searchColour.$or.some((f: any) => f.name instanceof RegExp && f.name.test('Rajgreen'))).toBe(true);

    const lqFinish: ListQuery = { ...baseQuery, q: 'Polish' };
    const filterFinish: any = buildFilter(lqFinish, stockitems, {});
    const searchFinish = filterFinish.$and.find((c: any) => Array.isArray(c.$or));
    expect(searchFinish.$or.some((f: any) => f.finish instanceof RegExp && f.finish.test('Polish'))).toBe(true);
  });

  it('supports comma-separated search terms e.g. "Raveena, Cal+Natural"', () => {
    const lq: ListQuery = { ...baseQuery, q: 'Raveena, Cal+Natural' };
    const filter: any = buildFilter(lq, stockitems, {});
    const searchClause = filter.$and.find((c: any) => Array.isArray(c.$or));
    const tokenAndClause = searchClause.$or.find((item: any) => Array.isArray(item.$and));

    expect(tokenAndClause).toBeDefined();
    expect(tokenAndClause.$and).toHaveLength(2);

    const calNaturalClause = tokenAndClause.$and[1];
    expect(calNaturalClause.$or.some((f: any) => f.finish instanceof RegExp && f.finish.test('Cal+Natural'))).toBe(true);
  });

  it('supports numeric size and thickness search in combination with colour name e.g. "Rajgreen 60"', () => {
    const lq: ListQuery = { ...baseQuery, q: 'Rajgreen 60' };
    const filter: any = buildFilter(lq, stockitems, {});
    const searchClause = filter.$and.find((c: any) => Array.isArray(c.$or));
    const tokenAndClause = searchClause.$or.find((item: any) => Array.isArray(item.$and));

    expect(tokenAndClause).toBeDefined();
    // Word 2 is "60" which should match number fields (sizeL, sizeW) as well as regex
    const sixtyClause = tokenAndClause.$and[1];
    expect(sixtyClause.$or.some((f: any) => f.sizeL === 60 || f.sizeW === 60)).toBe(true);
  });

  it('matches "green swan" against Green Colour and Sawn Finish via synonym mapping', () => {
    const lq: ListQuery = { ...baseQuery, q: 'green swan' };
    const filter: any = buildFilter(lq, stockitems, {});
    const searchClause = filter.$and.find((c: any) => Array.isArray(c.$or));
    const tokenAndClause = searchClause.$or.find((item: any) => Array.isArray(item.$and));

    expect(tokenAndClause).toBeDefined();
    expect(tokenAndClause.$and).toHaveLength(2); // "green" and "swan"

    // Token 1 ("green") matches name "Green"
    const greenClause = tokenAndClause.$and[0];
    expect(greenClause.$or.some((f: any) => f.name instanceof RegExp && f.name.test('Green'))).toBe(true);

    // Token 2 ("swan") matches finish "Sawn" (via swan/sawn synonym mapping)
    const swanClause = tokenAndClause.$and[1];
    expect(swanClause.$or.some((f: any) => f.finish instanceof RegExp && f.finish.test('Sawn'))).toBe(true);
  });
});

