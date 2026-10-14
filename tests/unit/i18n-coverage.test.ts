import { describe, expect, it } from 'vitest';
import { extractPhrases } from '../../scripts/extract-phrases.mjs';
import { HI } from '@/lib/hi';
import { translatePhrase } from '@/lib/i18n';

const dict = HI as Record<string, string>;
const slots = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('Hindi for the screens', () => {
  const phrases: Map<string, string> = extractPhrases('.');

  it('finds the screen text at all (so this test cannot pass by finding nothing)', () => {
    expect(phrases.size).toBeGreaterThan(800);
  });

  it('every English phrase in the screens has a Hindi translation', () => {
    const missing = [...phrases.entries()].filter(([p]) => !(p in dict)).map(([p, file]) => `${p}   (${file.split('\\').join('/')})`);
    expect(missing, 'Add these to lib/hi/ (the exact English phrase is the key)').toEqual([]);
  });

  it('no label is built by gluing a value into English text (it could not be translated): use tr("... {n} ...", { n })', () => {
    const templates: string[] = [];
    extractPhrases('.', templates);
    expect(templates).toEqual([]);
  });

  it('every translation is filled in, is Devanagari (or deliberately the same), and keeps the {values} of the English text', () => {
    const bad: string[] = [];
    for (const [en, hi] of Object.entries(dict)) {
      if (!hi || !hi.trim()) bad.push(`${en}: empty`);
      else if (JSON.stringify(slots(en)) !== JSON.stringify(slots(hi))) bad.push(`${en}: {values} differ`);
      else if (hi !== en && !/[ऀ-ॿ]/.test(hi)) bad.push(`${en}: not Hindi`);
    }
    expect(bad).toEqual([]);
  });

  it('looks a phrase up exactly, fills {values}, and falls back to the English text for anything unknown', () => {
    expect(translatePhrase(dict, 'Save')).toBe('सेव');
    expect(translatePhrase(dict, '{n} done', { n: 3 })).toBe('3 हो गए');
    expect(translatePhrase(dict, 'A phrase nobody translated', { n: 3 })).toBe('A phrase nobody translated');
    expect(translatePhrase(null, 'Save')).toBe('Save'); // English users: untouched
  });
});
