import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { AssetSource, AssetUploader, UploadedAsset } from '../types.js';
import { withTrailingSlash } from '../utils.js';

// A lightweight, best-effort tag scan - consistent with how the rest of this
// package reads Markdown/HTML, rather than pulling in a full HTML parser.
const IMG_TAG = /<img\b[^>]*>/g;
const SRC_ATTR = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/; // literal whitespace before it, same reasoning as assets.ts
const ALT_ATTR = /\salt\s*=\s*(?:"([^"]*)"|'([^']*)')/;
const CONTENT_REGION = /<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/i;

interface RenderedImage {
  src: string;
  alt: string;
}

function extractImages(html: string): RenderedImage[] {
  const region = CONTENT_REGION.exec(html);
  const scoped = region ? region[2]! : html;

  const images: RenderedImage[] = [];
  for (const match of scoped.matchAll(IMG_TAG)) {
    const tag = match[0];
    const src = SRC_ATTR.exec(tag);
    if (!src) continue;
    const alt = ALT_ATTR.exec(tag);
    images.push({ src: (src[1] ?? src[2])!, alt: alt?.[1] ?? alt?.[2] ?? '' });
  }
  return images;
}

export interface DistHtmlUploaderOptions {
  /** Absolute path to the built site (Astro's output dir), already deployed by the time this runs. */
  distDir: string;
  /** Public site URL, used to turn a page-relative `src` into an absolute one. */
  siteUrl: string;
  /**
   * Maps a post's slug to its URL path under `distDir`. Defaults to the bare
   * slug (`dist/<slug>/index.html`) - override for a site where posts live
   * somewhere else, e.g. `(slug) => \`post/${slug}\`` for `/post/<slug>/`.
   */
  pagePath?: (slug: string) => string;
  /**
   * Reports which matching strategy each image took (exact `alt`, or the
   * riskier positional fallback) and flags a post where the number of
   * `<img>` tags found doesn't match the number of local images its Markdown
   * references - a page missing an image, or one the pipeline doesn't
   * recognise, tends to show up here first. Defaults to a no-op.
   */
  log?: (message: string) => void;
}

/**
 * Resolves an image not by uploading it anywhere, but by finding the URL it
 * already has on your own site - useful when syndication runs *after* your
 * host has deployed (see the README's "Two ways to trigger it"), so the
 * genuinely live, already-hashed URL Astro's own build produced is sitting
 * right there in `distDir`, no third-party host needed.
 *
 * Matches each image against the `<img>` tags rendered inside `<main>` or
 * `<article>` on that post's own page: first by exact `alt` text, then by
 * position among the tags no earlier image on the same post already claimed.
 * A post whose images share identical (or empty) alt text falls back to
 * document order, which is usually - but not guaranteed to be - correct.
 *
 * Caveat shared with any cache-backed uploader: once an image's URL is
 * cached in `deployments.assets`, `upload()` is never called for it again on
 * an unchanged file, so it never occupies a position slot on a later run.
 * That's fine for alt-matched images; a post that leans on position-only
 * matching *and* only partially changes could match a changed, alt-less
 * image against the wrong tag. Posts in practice almost always set `alt`,
 * which sidesteps this entirely.
 */
export class DistHtmlUploader implements AssetUploader {
  public readonly name = 'dist-html';

  readonly #distDir: string;
  readonly #siteUrl: string;
  readonly #pagePath: (slug: string) => string;
  readonly #log: (message: string) => void;
  readonly #htmlCache = new Map<string, RenderedImage[] | undefined>();
  readonly #claimed = new Map<string, Set<number>>();
  readonly #countChecked = new Set<string>();

  constructor(options: DistHtmlUploaderOptions) {
    this.#distDir = options.distDir;
    this.#siteUrl = withTrailingSlash(options.siteUrl);
    this.#pagePath = options.pagePath ?? ((slug) => slug);
    this.#log = options.log ?? (() => {});
  }

  public setup(): void {
    if (!this.#distDir) {
      throw new Error('[syndication/assets] DistHtmlUploader needs distDir');
    }
    if (!/^https?:\/\//i.test(this.#siteUrl)) {
      throw new Error('[syndication/assets] DistHtmlUploader needs an absolute siteUrl');
    }
  }

  async #imagesFor(slug: string): Promise<RenderedImage[] | undefined> {
    if (this.#htmlCache.has(slug)) return this.#htmlCache.get(slug);

    const htmlPath = join(this.#distDir, this.#pagePath(slug), 'index.html');
    let images: RenderedImage[] | undefined;
    try {
      images = extractImages(await readFile(htmlPath, 'utf8'));
    } catch {
      images = undefined;
    }
    this.#htmlCache.set(slug, images);
    return images;
  }

  /**
   * Warns, once per slug, when the number of `<img>` tags found doesn't match
   * the number of local images the post's Markdown references. Equal counts
   * don't prove every match is correct, but a mismatch is a strong, easy
   * signal that something is off - a missing image, one added outside a
   * syntax `resolveMdxImages` recognises, or unrelated markup slipping into
   * the scoped region.
   */
  #checkPlausibleCount(slug: string, images: RenderedImage[], expected: number | undefined): void {
    if (expected === undefined || this.#countChecked.has(slug)) return;
    this.#countChecked.add(slug);

    if (images.length !== expected) {
      this.#log(
        `plausibility check failed for "${slug}": its Markdown references ${expected} local image(s), ` +
          `but ${images.length} <img> tag(s) were found in the built page's <main>/<article> - ` +
          'matches below may be wrong; double-check alt text and that every image actually rendered',
      );
    }
  }

  public async upload(asset: AssetSource): Promise<UploadedAsset> {
    const images = await this.#imagesFor(asset.slug);
    if (!images) {
      throw new Error(
        `[syndication/assets] no built page found for "${asset.slug}" under ${this.#distDir} - ` +
          'DistHtmlUploader needs the site already built (and deployed) before syndication runs',
      );
    }
    this.#checkPlausibleCount(asset.slug, images, asset.totalLocalImages);

    const claimed = this.#claimed.get(asset.slug) ?? new Set<number>();
    this.#claimed.set(asset.slug, claimed);

    // Alt text is the safest signal available: it is an explicit, exact
    // match rather than an assumption about rendering order, so it is tried
    // first and always wins over position when both would apply.
    let index = -1;
    if (asset.alt) {
      index = images.findIndex((img, i) => !claimed.has(i) && img.alt === asset.alt);
    }

    if (index !== -1) {
      this.#log(`"${asset.ref}" on "${asset.slug}": matched by alt text "${asset.alt}"`);
    } else {
      index = images.findIndex((_img, i) => !claimed.has(i));
      if (index !== -1) {
        this.#log(
          `"${asset.ref}" on "${asset.slug}": no alt match (alt: ${asset.alt || '<none>'}), ` +
            `fell back to position ${index} - set a unique alt on this image to make the match exact`,
        );
      }
    }

    if (index === -1) {
      throw new Error(
        `[syndication/assets] could not match "${asset.ref}" (alt: ${asset.alt ?? '<none>'}) ` +
          `to a rendered image on ${asset.slug} - it may have already been fully matched, or removed from the page`,
      );
    }

    claimed.add(index);
    return { url: new URL(images[index]!.src.replace(/^\//, ''), this.#siteUrl).href };
  }
}
