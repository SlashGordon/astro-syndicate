import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

import type { AssetUploader } from './types.js';
import { delay } from './utils.js';

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
};

/** Recognised image extensions, exported so `mdx-jsx.ts` can tell an image import from a component import. */
export const IMAGE_EXTENSIONS = new Set(Object.keys(MIME_BY_EXT));

// --- Markdown / HTML image detection ------------------------------------
//
// This is a best-effort scanner, not a full Markdown parser. It reliably
// handles the two syntaxes almost every post actually uses:
//   - inline images:   ![alt](src "title")   (src may be wrapped in <...>)
//   - raw HTML images: <img src="...">       (the literal `src` attribute,
//                       never `data-src` or other lazy-load attributes)
// Matches inside fenced code blocks and inline code spans are ignored, so a
// post that *shows* Markdown/HTML syntax as an example never gets that
// example text rewritten.
//
// Known, deliberate gaps (rare in blog posts, not worth a full parser):
//   - reference-style images: ![alt][ref] + [ref]: ./path.png
//   - alt text containing unescaped "[" / "]"
// A post relying on either has that image silently left untouched.

const MARKDOWN_IMAGE =
  /!\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/gd;
// Requires a literal whitespace right before "src" so "data-src=" (common in
// lazy-loading themes) never matches — only whitespace precedes a real attribute.
const HTML_IMG_SRC = /<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gid;
const HTML_IMG_ALT = /\salt\s*=\s*(?:"([^"]*)"|'([^']*)')/;
const FENCED_CODE_BLOCK = /^([`~]{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm;
const INLINE_CODE_SPAN = /(`+)(?!`)[\s\S]*?\1/g;

function stripAngles(value: string): string {
  return value.startsWith('<') && value.endsWith('>') ? value.slice(1, -1) : value;
}

/**
 * Byte ranges to treat as opaque: fenced code blocks and inline code spans.
 * Exported for `mdx-jsx.ts`, which needs the same "don't touch code examples"
 * masking for its own import/JSX rewrites.
 */
export function codeRanges(markdown: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const match of markdown.matchAll(FENCED_CODE_BLOCK)) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  for (const match of markdown.matchAll(INLINE_CODE_SPAN)) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

export function isMasked(index: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

/** `true` for absolute URLs, protocol-relative URLs and `data:` URIs. */
export function isRemoteRef(ref: string): boolean {
  return /^(?:https?:)?\/\//i.test(ref) || ref.startsWith('data:');
}

interface ImageOccurrence {
  /** Reference with any wrapping `<...>` stripped — used as the cache/map key. */
  ref: string;
  /** Absolute start/end of the span to replace (includes `<...>` if present). */
  start: number;
  end: number;
  /** Alt text at this occurrence, if any - lets an uploader tell two images in the same post apart. */
  alt?: string;
}

/** Every image occurrence in a Markdown body, code spans excluded, in document order. */
function findOccurrences(markdown: string): ImageOccurrence[] {
  const ranges = codeRanges(markdown);
  const occurrences: ImageOccurrence[] = [];

  for (const match of markdown.matchAll(MARKDOWN_IMAGE)) {
    if (isMasked(match.index, ranges)) continue;
    const [start, end] = match.indices![2]!;
    occurrences.push({ ref: stripAngles(markdown.slice(start, end)), start, end, alt: match[1] });
  }

  for (const match of markdown.matchAll(HTML_IMG_SRC)) {
    if (isMasked(match.index, ranges)) continue;
    const [start, end] = (match.indices![1] ?? match.indices![2])!;
    const altMatch = HTML_IMG_ALT.exec(match[0]);
    occurrences.push({ ref: markdown.slice(start, end), start, end, alt: altMatch?.[1] ?? altMatch?.[2] });
  }

  return occurrences.sort((a, b) => a.start - b.start);
}

/** Every distinct image reference found in a Markdown body. */
export function findImageRefs(markdown: string): string[] {
  return [...new Set(findOccurrences(markdown).map((occurrence) => occurrence.ref))];
}

/** Resolve a reference to an absolute path on disk. */
function refToPath(ref: string, postDir: string, publicDir: string): string {
  const clean = ref.split(/[?#]/)[0];
  // A leading "/" means "site root" -> Astro's public/ directory.
  return clean.startsWith('/') ? join(publicDir, clean) : resolve(postDir, clean);
}

/** Splice hosted URLs into the exact spans `findOccurrences` located. */
function replaceRefs(markdown: string, map: Map<string, string>): string {
  const occurrences = findOccurrences(markdown).filter((occurrence) => map.has(occurrence.ref));
  if (occurrences.length === 0) return markdown;

  let out = '';
  let cursor = 0;
  for (const occurrence of occurrences) {
    out += markdown.slice(cursor, occurrence.start) + map.get(occurrence.ref)!;
    cursor = occurrence.end;
  }
  out += markdown.slice(cursor);
  return out;
}

export interface AssetPipelineOptions {
  uploader: AssetUploader;
  /** Directory of the post file, used to resolve `./img.png` refs. */
  postDir: string;
  /** Directory mapped to the site root, used to resolve `/img.png` refs. */
  publicDir: string;
  /** Existing `"<uploader.name>:<hash>" -> URL` cache from `deployments.assets`. */
  cache: Record<string, string>;
  /** ms to wait after each real upload (rate-limit guard). */
  requestDelayMs: number;
  /** Slug of the post being processed, passed straight through to `AssetUploader.upload()`. */
  slug: string;
  log: (message: string) => void;
}

/**
 * Per-post helper that turns local image references into hosted URLs.
 *
 * - `resolve()` maps one reference to a URL, uploading on a cache miss.
 * - `rewriteMarkdown()` swaps every local image in a body for its URL.
 *
 * Results are memoised by file hash in `assetMap`; persist that back to
 * `deployments.assets` so unchanged images never upload twice.
 */
export class AssetPipeline {
  readonly #opts: AssetPipelineOptions;
  readonly #cache: Record<string, string>;
  readonly #seen = new Set<string>();

  /** Number of real uploads performed by this pipeline. */
  public uploads = 0;
  /** `true` once the cache has gained at least one new entry. */
  public dirty = false;

  constructor(options: AssetPipelineOptions) {
    this.#opts = options;
    this.#cache = { ...options.cache };
  }

  /** `"<uploader.name>:<hash>" -> URL` cache, ready to write back to frontmatter. */
  public get assetMap(): Record<string, string> {
    return this.#cache;
  }

  /** Fingerprints of every local image referenced so far (feeds the content hash). */
  public get seenHashes(): string[] {
    return [...this.#seen];
  }

  /** Map one reference to a hosted URL. Unresolvable refs come back unchanged. */
  public async resolve(ref: string, alt?: string, totalLocalImages?: number): Promise<string> {
    if (isRemoteRef(ref)) return ref;

    const absPath = refToPath(ref, this.#opts.postDir, this.#opts.publicDir);

    let bytes: Buffer;
    try {
      bytes = await readFile(absPath);
    } catch {
      this.#opts.log(`image not found, left as-is: ${ref}`);
      return ref;
    }

    const hash = createHash('sha256').update(bytes).digest('hex');
    this.#seen.add(hash);

    // Namespaced by uploader name: switching `assetUploader` (e.g. from
    // SiteUrlUploader to CloudinaryUploader) must never reuse a URL some
    // OTHER uploader produced - that would silently keep sending a broken
    // link forever, since an unchanged file would never re-upload again.
    const cacheKey = `${this.#opts.uploader.name}:${hash}`;

    const cached = this.#cache[cacheKey];
    if (cached) {
      return cached;
    }

    const uploaded = await this.#opts.uploader.upload({
      ref,
      absPath,
      hash,
      bytes,
      contentType: MIME_BY_EXT[extname(absPath).toLowerCase()] ?? 'application/octet-stream',
      alt,
      slug: this.#opts.slug,
      totalLocalImages,
    });

    this.#cache[cacheKey] = uploaded.url;
    this.uploads += 1;
    this.dirty = true;
    this.#opts.log(`uploaded ${ref} -> ${uploaded.url}`);

    if (this.#opts.requestDelayMs > 0) {
      await delay(this.#opts.requestDelayMs);
    }

    return uploaded.url;
  }

  /** Rewrite every local image reference in a Markdown body to its hosted URL. */
  public async rewriteMarkdown(markdown: string): Promise<string> {
    const map = new Map<string, string>();
    const seenRefs = new Set<string>();

    const occurrences = findOccurrences(markdown);
    // Every local occurrence, not deduplicated by ref: a source file used
    // twice renders as two separate `<img>` tags, so this is the number an
    // uploader matching against rendered HTML should expect to find there.
    const totalLocalImages = occurrences.filter((occurrence) => !isRemoteRef(occurrence.ref)).length;

    // Resolve each distinct ref once, using the alt text of its *first*
    // occurrence - the same file referenced twice is the same upload either
    // way, so only the first occurrence's alt is available to an uploader
    // that needs one to disambiguate (e.g. matching it against rendered HTML).
    for (const occurrence of occurrences) {
      if (seenRefs.has(occurrence.ref)) continue;
      seenRefs.add(occurrence.ref);

      const url = await this.resolve(occurrence.ref, occurrence.alt, totalLocalImages);
      if (url !== occurrence.ref) {
        map.set(occurrence.ref, url);
      }
    }

    return replaceRefs(markdown, map);
  }
}
