import { describe, expect, it } from 'vitest';

import { normalizeTags, normalizeText, resolveSyndicateTargets } from '../../src/integrations/syndication/frontmatter';
import type { SyncContext, SyncResult, SyndicationProvider } from '../../src/integrations/syndication/types';

function makeProvider(name: string): SyndicationProvider {
  return {
    name,
    setup: async () => {},
    sync: async (_ctx: SyncContext): Promise<SyncResult> => ({ provider: name, action: 'created', message: '' }),
  };
}

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

describe('resolveSyndicateTargets', () => {
  const devto = makeProvider('devto');
  const medium = makeProvider('medium');
  const providers = [devto, medium];

  it('opts into every configured provider for the legacy `syndicate: true` form', () => {
    expect(resolveSyndicateTargets(true, providers)).toEqual([devto, medium]);
  });

  it('opts into only the providers explicitly set to true', () => {
    expect(resolveSyndicateTargets({ devto: true, medium: false }, providers)).toEqual([devto]);
  });

  it('opts into nothing for a provider missing from the object', () => {
    expect(resolveSyndicateTargets({ devto: true }, providers)).toEqual([devto]);
    expect(resolveSyndicateTargets({}, providers)).toEqual([]);
  });

  it('ignores a key that does not match any configured provider', () => {
    expect(resolveSyndicateTargets({ hashnode: true }, providers)).toEqual([]);
  });

  it('opts into nothing for `false`, missing, or any other non-object value', () => {
    expect(resolveSyndicateTargets(false, providers)).toEqual([]);
    expect(resolveSyndicateTargets(undefined, providers)).toEqual([]);
    expect(resolveSyndicateTargets(null, providers)).toEqual([]);
    expect(resolveSyndicateTargets('devto', providers)).toEqual([]);
    expect(resolveSyndicateTargets(1, providers)).toEqual([]);
  });

  it('returns an empty array when no providers are configured at all', () => {
    expect(resolveSyndicateTargets(true, [])).toEqual([]);
    expect(resolveSyndicateTargets({ devto: true }, [])).toEqual([]);
  });
});
