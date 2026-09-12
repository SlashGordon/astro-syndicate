/**
 * Small, pure helpers for turning loosely-typed frontmatter values into the
 * clean shapes `BlogPost` promises providers. Platform-specific limits (e.g.
 * dev.to's 4-tag cap) are deliberately NOT applied here - that belongs to
 * the provider that owns the limit.
 */

import type { SyndicationProvider } from './types.js';

/**
 * Resolve which of the configured providers a post opts into.
 *
 * `syndicate` is per-provider, keyed by `SyndicationProvider.name`:
 *
 *   syndicate:
 *     devto: true
 *     medium: false
 *
 * A post that suits dev.to but not Medium (or vice versa) needs to say so -
 * a single blanket flag can't express that. A provider missing from the
 * object defaults to `false`: opting in is always explicit, never implied by
 * omission. `syndicate: true` still works too, as shorthand for "every
 * configured provider" - the whole frontmatter contract before this existed,
 * and still the simplest form while there's only one provider in play.
 * Anything else (`false`, missing, a string, `null`, ...) opts into nothing.
 */
export function resolveSyndicateTargets(
  value: unknown,
  providers: readonly SyndicationProvider[],
): SyndicationProvider[] {
  if (value === true) return [...providers];
  if (!value || typeof value !== 'object') return [];

  const flags = value as Record<string, unknown>;
  return providers.filter((provider) => flags[provider.name] === true);
}

/**
 * Normalize a frontmatter `tags` value into a clean, deduplicated list.
 * Accepts an array (`tags: [Astro, typescript]`) or a comma-separated string
 * (`tags: "Astro, typescript"`). Blank entries are dropped; duplicates are
 * removed case-insensitively, keeping the first casing seen.
 */
export function normalizeTags(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];

  const seen = new Set<string>();
  const tags: string[] = [];

  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const tag = entry.trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }

  return tags;
}

/** Trim a frontmatter string field, returning `undefined` for blank/non-string values. */
export function normalizeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}
