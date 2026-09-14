/**
 * Small, pure helpers for turning loosely-typed frontmatter values into the
 * clean shapes `BlogPost` promises providers. Platform-specific limits (e.g.
 * dev.to's 4-tag cap) are deliberately NOT applied here - that belongs to
 * the provider that owns the limit.
 */

import type { SyndicateTarget, SyndicationProvider } from './types.js';

/**
 * Resolve which of the configured providers a post opts into, and any
 * per-provider overrides that come with it.
 *
 * `syndicate` is per-provider, keyed by `SyndicationProvider.name`. Each
 * entry is either `true` (opt in, use the post's own fields as-is) or an
 * object with `enable: true` plus whatever overrides that provider needs:
 *
 *   syndicate:
 *     devto:
 *       enable: true
 *       title: A dev.to-specific title
 *       series: The 35-Watt Roommate
 *     medium: false
 *
 * A post that suits dev.to but not Medium (or vice versa) needs to say so -
 * a single blanket flag can't express that. A provider missing from the
 * object, set to `false`, or an object without `enable: true` all opt into
 * nothing: opting in is always explicit, never implied by omission. An
 * override left out of the object (or the whole entry being plain `true`)
 * falls back to the post's own field - `title`, most commonly, since a
 * per-provider title is usually the exception, not the rule.
 *
 * `syndicate: true` still works too, as shorthand for "every configured
 * provider, no overrides" - the whole frontmatter contract before per-provider
 * opt-in existed, and still the simplest form while only one provider is in
 * play. Anything else (`false`, missing, a string, `null`, ...) opts into
 * nothing.
 */
export function resolveSyndicateTargets(
  value: unknown,
  providers: readonly SyndicationProvider[],
): SyndicateTarget[] {
  if (value === true) return providers.map((provider) => ({ provider, overrides: {} }));
  if (!value || typeof value !== 'object') return [];

  const flags = value as Record<string, unknown>;
  const targets: SyndicateTarget[] = [];

  for (const provider of providers) {
    const entry = flags[provider.name];

    if (entry === true) {
      targets.push({ provider, overrides: {} });
      continue;
    }

    if (entry && typeof entry === 'object' && (entry as Record<string, unknown>).enable === true) {
      const obj = entry as Record<string, unknown>;
      targets.push({
        provider,
        overrides: {
          title: normalizeText(obj.title),
          series: normalizeText(obj.series),
        },
      });
    }
  }

  return targets;
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
