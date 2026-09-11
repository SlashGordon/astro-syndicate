import { describe, expect, it } from 'vitest';

import { normalizeTags, normalizeText } from '../../src/integrations/syndication/frontmatter';

describe('normalizeTags', () => {
  it('accepts an array of strings', () => {
    expect(normalizeTags(['astro', 'typescript'])).toEqual(['astro', 'typescript']);
  });

  it('accepts a comma-separated string', () => {
    expect(normalizeTags('astro, typescript, webdev')).toEqual(['astro', 'typescript', 'webdev']);
  });

  it('trims whitespace and drops empty entries', () => {
    expect(normalizeTags(' astro ,, typescript ,  ')).toEqual(['astro', 'typescript']);
  });

  it('deduplicates case-insensitively, keeping the first casing seen', () => {
    expect(normalizeTags(['Astro', 'astro', 'ASTRO'])).toEqual(['Astro']);
  });

  it('ignores non-string entries in an array instead of throwing', () => {
    expect(normalizeTags(['astro', 42, null, 'webdev'])).toEqual(['astro', 'webdev']);
  });

  it('returns an empty array for missing or non-string/array values', () => {
    expect(normalizeTags(undefined)).toEqual([]);
    expect(normalizeTags(null)).toEqual([]);
    expect(normalizeTags(42)).toEqual([]);
  });
});

describe('normalizeText', () => {
  it('trims a non-empty string', () => {
    expect(normalizeText('  hello  ')).toBe('hello');
  });

  it('returns undefined for a blank or whitespace-only string', () => {
    expect(normalizeText('')).toBeUndefined();
    expect(normalizeText('   ')).toBeUndefined();
  });

  it('returns undefined for a non-string value', () => {
    expect(normalizeText(42)).toBeUndefined();
    expect(normalizeText(undefined)).toBeUndefined();
    expect(normalizeText(null)).toBeUndefined();
  });
});
