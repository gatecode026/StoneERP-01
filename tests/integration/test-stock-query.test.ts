import { describe, it, expect } from 'vitest';
import { useTestDb } from '../helpers';
import { StockItem } from '@/lib/models/stock';
import { stockitems } from '@/lib/resources/stock';
import { buildFilter } from '@/lib/api/query';

describe('Stock Item API Search Integration', () => {
  it('supports searching colour name + finish (e.g. "green sawn", "green swan", "Mint")', async () => {
    const db = await useTestDb('stock_search_integration');
    try {
      await StockItem.create({
        name: 'Green',
        finish: 'Sawn',
        sizeL: 75,
        sizeW: 25,
        thickness: '20mm',
        category: 'finished',
        unit: 'sq ft',
      });

      const { makeUser, api } = await import('../api');
      const owner = await makeUser('owner');

      // 1. Search for non-existent colour "Mint" should return 200 with empty list (no 400 CastError)
      const mintRes = await api.list(owner, 'stockitems', 'sort=name&q=Mint&page=1&limit=25&count=1');
      expect(mintRes.status).toBe(200);
      expect(mintRes.json.data).toEqual([]);
      expect(mintRes.json.total).toBe(0);

      // 2. Search for exact combination "green sawn"
      const sawnRes = await api.list(owner, 'stockitems', 'sort=name&q=green+sawn&page=1&limit=25&count=1');
      expect(sawnRes.status).toBe(200);
      expect(sawnRes.json.data.length).toBe(1);
      expect(sawnRes.json.data[0].name).toBe('Green');
      expect(sawnRes.json.data[0].finish).toBe('Sawn');

      // 3. Search for typo/synonym "green swan"
      const swanRes = await api.list(owner, 'stockitems', 'sort=name&q=green+swan&page=1&limit=25&count=1');
      expect(swanRes.status).toBe(200);
      expect(swanRes.json.data.length).toBe(1);
      expect(swanRes.json.data[0].name).toBe('Green');
      expect(swanRes.json.data[0].finish).toBe('Sawn');

      // 4. Verify buildFilter directly
      const lq = {
        q: 'green swan',
        limit: 25,
        sortField: 'name',
        sortDir: 1,
        match: {},
        extra: [],
        includeVoid: false,
        count: true,
        select: [...stockitems.listFields, 'isVoid'],
      };
      const filter = buildFilter(lq as any, stockitems, {});
      const directMatches = await StockItem.find(filter).lean();
      expect(directMatches.length).toBe(1);
      expect(directMatches[0].name).toBe('Green');
    } finally {
      await db.close();
    }
  });
});
