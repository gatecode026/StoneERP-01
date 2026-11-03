/* eslint-disable @typescript-eslint/no-explicit-any */
import { StockItem } from '../models';
import { cached } from '../cache';

/**
 * Everything the dashboards and reminders need to know about stock, read in ONE round trip.
 * Before this, one dashboard build asked the stock collection six separate questions (items below minimum, the biggest finished items,
 * the item count, stock against minimum, the finished-goods rates, and the reminder list). They are all slices of the same small
 * collection, so they are cut here in one aggregate (output is bounded) and shared by every caller.
 *
 * Cached for 10 s and dropped by the same tags as the home itself ('home' / 'reminders': every committed change, see lib/db.ts; 'stockitems':
 * stock edits). Not per person: these reads never carried a scope filter, the callers only decide whether the person may see them.
 */
export type StockRow = { _id: unknown; name: string; balance: number; minLevel: number; unit: string };
export type StockSnapshot = {
  /** live items */
  total: number;
  /** items below their minimum, oldest first (at most 100) */
  low: StockRow[];
  /** the six finished items worth the most (balance x selling rate) */
  main: StockRow[];
  /** items that have a minimum level set (at most 300), for "stock against minimum" */
  levels: StockRow[];
  /** finished goods with a selling rate: the sum of the rates and how many */
  rateSum: number;
  rateCount: number;
};

const FIELDS = { name: 1, balance: 1, minLevel: 1, unit: 1 };

export function stockSnapshot(): Promise<Readonly<StockSnapshot>> {
  return cached('stock:snapshot', 10_000, ['home', 'reminders', 'stockitems'], async () => {
    const [r]: any[] = await StockItem.aggregate([
      { $match: { isVoid: false } },
      { $facet: {
        total: [{ $count: 'n' }],
        low: [{ $match: { belowMin: true } }, { $sort: { _id: 1 } }, { $limit: 100 }, { $project: FIELDS }],
        main: [{ $match: { category: 'finished' } }, { $addFields: { value: { $multiply: ['$balance', { $ifNull: ['$sellRate', 0] }] } } }, { $sort: { value: -1, _id: 1 } }, { $limit: 6 }, { $project: FIELDS }],
        levels: [{ $match: { minLevel: { $gt: 0 } } }, { $limit: 300 }, { $project: FIELDS }],
        rates: [{ $match: { category: 'finished', sellRate: { $gt: 0 } } }, { $group: { _id: null, sum: { $sum: '$sellRate' }, n: { $sum: 1 } } }],
      } },
    ]);
    return {
      total: Number(r?.total?.[0]?.n) || 0,
      low: r?.low ?? [],
      main: r?.main ?? [],
      levels: r?.levels ?? [],
      rateSum: Number(r?.rates?.[0]?.sum) || 0,
      rateCount: Number(r?.rates?.[0]?.n) || 0,
    };
  });
}
