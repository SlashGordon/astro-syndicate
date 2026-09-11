import { readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { withTrailingSlash } from './utils';

const MARKDOWN_EXT = new Set(['.md', '.mdx']);

export interface ResolveCanonicalUrlArgs {
  data: Record<string, unknown>;
  slug: string;
  siteUrl: string | undefined;
  getCanonicalUrl?: (post: { slug: string; data: Record<string, unknown> }) => string;
}

/**
 * Resolve a post's canonical URL.
 * Precedence: frontmatter `canonicalUrl` > `getCanonicalUrl` option > `${siteUrl}/blog/${slug}/`.
 */
export function resolveCanonicalUrl(args: ResolveCanonicalUrlArgs): string {
  const { data, slug, siteUrl, getCanonicalUrl } = args;

  if (typeof data.canonicalUrl === 'string' && data.canonicalUrl) {
    return data.canonicalUrl;
  }
  if (getCanonicalUrl) {
    return getCanonicalUrl({ slug, data });
  }
  if (siteUrl) {
    return new URL(`blog/${slug}/`, withTrailingSlash(siteUrl)).href;
  }
  throw new Error(
    'cannot build canonical_url - set `site` in astro.config.mjs, pass `siteUrl`, ' +
      'add `canonicalUrl` to the frontmatter, or provide `getCanonicalUrl`',
  );
}

/** Recursively collect every `.md` / `.mdx` file under `root` (sorted, stable). */
export async function collectMarkdownFiles(root: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }

    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && MARKDOWN_EXT.has(extname(entry.name))) {
        out.push(full);
      }
    }
  }

  await walk(root);
  return out.sort();
}
