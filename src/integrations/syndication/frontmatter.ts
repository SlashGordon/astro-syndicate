/**
 * Small, pure helpers for turning loosely-typed frontmatter values into the
 * clean shapes `BlogPost` promises providers. Platform-specific limits (e.g.
 * dev.to's 4-tag cap) are deliberately NOT applied here - that belongs to
 * the provider that owns the limit.
 */

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
