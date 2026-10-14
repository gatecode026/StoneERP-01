import { describe, expect, it } from 'vitest';
import { DICT, translate } from '@/lib/i18n';

describe('English / Hindi dictionary', () => {
  it('every English text has a Hindi one, and the other way round', () => {
    const en = Object.keys(DICT.en);
    const hi = Object.keys(DICT.hi);
    expect(en.filter((k) => !hi.includes(k))).toEqual([]);
    expect(hi.filter((k) => !en.includes(k))).toEqual([]);
  });

  it('both languages use the same {placeholders}', () => {
    const slots = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(DICT.en)) expect([k, slots(DICT.hi[k as keyof typeof DICT.hi])]).toEqual([k, slots(DICT.en[k as keyof typeof DICT.en])]);
  });

  it('fills placeholders, falls back to English and then to the key', () => {
    expect(translate('en', 'pagerShowing', { from: 1, to: 25, total: 100 })).toBe('Showing 1–25 of 100');
    expect(translate('hi', 'pagerShowing', { from: 1, to: 25, total: 100 })).toBe('100 में से 1–25 दिख रहे हैं');
    expect(translate('hi', 'no_such_key')).toBe('no_such_key');
    expect(translate('en', 'syncRetrying', {})).toBe('Retrying ({n})'); // a missing value leaves the slot visible rather than "undefined"
  });
});
