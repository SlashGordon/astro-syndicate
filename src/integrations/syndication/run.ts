import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative } from 'node:path';

import matter from 'gray-matter';

import { AssetPipeline, findImageRefs, isRemoteRef } from './assets.js';
import { appendBacklink, type BacklinkOption } from './backlink.js';
import { normalizeTags, normalizeText, resolveSyndicateTargets } from './frontmatter.js';
import { generateContentHash } from './hashing.js';
import type { FolderImage } from './mdx-jsx.js';
import { resolveMdxImages } from './mdx-jsx.js';
import { collectMarkdownFiles, resolveCanonicalUrl } from './resolve.js';
import type {
  AssetUploader,
  BlogPost,
  Deployments,
  SyncContext,
  SyndicationProvider,
} from './types.js';
import { delay, withTrailingSlash } from './utils.js';

/**
 * Minimal logging contract. `console` satisfies this directly, and so does
 * the logger Astro passes into an integration hook - `runSyndication` works
 * identically called from `astro:build:done` or from a plain script.
 */
export interface SyndicationLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface SyndicationOptions {
  /**
   * Providers to run, in registration order. Being configured here makes a
   * provider *available*, not automatic - each post's own `syndicate`
   * frontmatter (keyed by provider name) decides which of these it actually
   * opts into. See `resolveSyndicateTargets` in `frontmatter.ts`.
   */
  providers: SyndicationProvider[];
  /** Blog content directory, relative to the project root. */
  contentDir?: string;
  /**
   * Public site URL used to build each post's `canonical_url`.
   * Defaults to `site` from `astro.config.mjs` when run as an integration.
   */
  siteUrl?: string;
  /**
   * Build a canonical URL from a post. Overrides the default
   * `${siteUrl}/blog/${slug}/`. A frontmatter `canonicalUrl` still wins over this.
   */
  getCanonicalUrl?: (post: { slug: string; data: Record<string, unknown> }) => string;
  /** Delay after each API / upload call, in ms. Defaults to 2000. */
  requestDelayMs?: number;
  /**
   * Set to `false` to skip the whole run. Defaults to `true`.
   *
   * The common use for this is an environment check, e.g.
   * `enabled: process.env.CONTEXT === 'production'` (Netlify),
   * `enabled: process.env.VERCEL_ENV === 'production'` (Vercel), or
   * `enabled: process.env.NODE_ENV === 'production'` - so a local build, a
   * PR preview, or CI don't syndicate anything.
   */
  enabled?: boolean;
  /**
   * Makes local post images reachable from remote platforms. When omitted,
   * posts that reference local images are still synced but those images are
   * left as relative paths (a warning is logged).
   */
  assetUploader?: AssetUploader;
  /** Directory that maps to the site root for `/img/x.png` refs. Defaults to `public`. */
  publicDir?: string;
  /** Frontmatter key holding the cover-image path. Defaults to `coverImage`. */
  coverImageField?: string;
  /**
   * Resolves a folder-driven gallery component's `folderPath="..."` prop (any
   * capitalised JSX component using that convention - astro-gallery's
   * `MapGallery`/`ImageTimeline`/etc. included) to the images it renders at
   * build time. That list isn't written anywhere in the MDX source, only the
   * integration owning the convention knows it, so without this hook such a
   * component is stripped from the body sent to a provider and a warning is
   * logged, rather than guessed at. See the README for a `fast-glob`-based
   * example.
   */
  resolveFolderImages?: (
    folderPath: string,
    ctx: { postDir: string },
  ) => FolderImage[] | Promise<FolderImage[]>;
  /**
   * Visible "originally published at" line appended to the body sent to
   * every provider - `canonical_url` is metadata, most platforms don't
   * render it as a link for readers. Pass a function for custom text/format,
   * or `false` to disable. Defaults to a line linking the post's own domain
   * to its canonical URL.
   */
  backlink?: BacklinkOption;
}

export interface RunSyndicationOptions extends SyndicationOptions {
  /** Absolute path `contentDir` / `publicDir` are resolved against. */
  projectRoot: string;
  /** Defaults to `console` - only relevant when calling this outside Astro. */
  logger?: SyndicationLogger;
}

export interface RunSyndicationResult {
  /** Total number of real network calls made (uploads + provider syncs). */
  totalCalls: number;
}

/**
 * Run one full syndication pass over a content directory.
 *
 * This is the actual work; `syndication()`'s `astro:build:done` hook is a
 * thin wrapper around it. Calling it directly - from a plain Node/tsx
 * script, say - is exactly as supported, and is how you'd run syndication as
 * its own step *after* your host finishes deploying instead of inside
 * `astro build` itself: that way dev.to (and any local-image host) only
 * ever sees URLs that are already live, rather than a build's-worth of
 * assets that haven't been uploaded yet.
 */
export async function runSyndication(options: RunSyndicationOptions): Promise<RunSyndicationResult> {
  const {
    providers,
    projectRoot,
    contentDir = 'src/content/blog',
    siteUrl,
    requestDelayMs = 2000,
    enabled = true,
    assetUploader,
    coverImageField = 'coverImage',
    resolveFolderImages,
    backlink,
    getCanonicalUrl,
    logger = console,
  } = options;

  if (!enabled) {
    logger.info('disabled - skipping syndication.');
    return { totalCalls: 0 };
  }
  if (providers.length === 0) {
    logger.warn('no providers configured - nothing to do.');
    return { totalCalls: 0 };
  }

  const contentRoot = join(projectRoot, contentDir);
  const publicDir = join(projectRoot, options.publicDir ?? 'public');

  // Validate every provider (and the uploader) up front so bad credentials
  // fail the run before we start mutating source files.
  for (const provider of providers) {
    await provider.setup();
  }
  await assetUploader?.setup();

  const files = await collectMarkdownFiles(contentRoot);
  if (files.length === 0) {
    logger.warn(`no .md/.mdx files found under ${contentDir}`);
    return { totalCalls: 0 };
  }
  logger.info(`scanning ${files.length} file(s) under ${contentDir}`);

  let totalCalls = 0;

  for (const filePath of files) {
    const rel = relative(projectRoot, filePath);

    const raw = await readFile(filePath, 'utf8');
    const parsed = matter(raw);
    // Copy, never mutate `parsed.data` directly: gray-matter caches parse
    // results globally, keyed by the exact raw input string, whenever
    // `matter()` is called without an `options` argument (as it is here).
    // Writing onto the shared object would corrupt that cache entry for any
    // other read of byte-identical content - a real risk across repeated
    // calls in one process, not just a test-fixture fluke.
    const data: Record<string, unknown> = { ...parsed.data };

    // 1. Opt-in gate: which of the configured providers, if any, want this post.
    const targets = resolveSyndicateTargets(data.syndicate, providers);
    if (targets.length === 0) {
      continue;
    }

    const title = typeof data.title === 'string' ? data.title.trim() : '';
    if (!title) {
      logger.warn(`${rel}: opts into syndication but has no title - skipped`);
      continue;
    }

    const slug =
      typeof data.slug === 'string' && data.slug
        ? data.slug
        : basename(filePath, extname(filePath));

    let canonicalUrl: string;
    try {
      canonicalUrl = resolveCanonicalUrl({ data, slug, siteUrl, getCanonicalUrl });
    } catch (error) {
      logger.error(`${rel}: ${(error as Error).message}`);
      continue;
    }

    // 2. Read existing state.
    const previous =
      data.deployments && typeof data.deployments === 'object'
        ? (data.deployments as Deployments)
        : {};
    const deployments: Deployments = { ...previous };
    let frontmatterDirty = false;

    // 3. Resolve local images to hosted URLs *before* hashing, so the
    //    hash reflects the body that will actually be sent.
    let body = parsed.content;
    let coverImageUrl: string | undefined;
    let assetFingerprints: string[] = [];

    // .mdx only: a plain .md file cannot contain JSX in the first place.
    // Turns `<Image src={imported} />` and similar gallery-component syntax
    // back into plain `![alt](src)` Markdown, and drops the `import` lines
    // that fed them, before the regular image pipeline below ever runs.
    if (extname(filePath).toLowerCase() === '.mdx') {
      body = await resolveMdxImages(body, {
        postDir: dirname(filePath),
        resolveFolderImages,
        log: (message) => logger.info(`${rel} [mdx]: ${message}`),
      });
    }

    const coverRef =
      typeof data[coverImageField] === 'string' ? (data[coverImageField] as string) : undefined;

    // Set when the asset step fails, so this post falls straight through to
    // step 6 instead of syncing a body with broken or half-rewritten image
    // references to any provider.
    let assetStepFailed = false;

    if (assetUploader) {
      const prevAssets =
        deployments.assets && typeof deployments.assets === 'object'
          ? (deployments.assets as Record<string, string>)
          : {};

      const pipeline = new AssetPipeline({
        uploader: assetUploader,
        postDir: dirname(filePath),
        publicDir,
        cache: prevAssets,
        requestDelayMs,
        slug,
        log: (message) => logger.info(`${rel} [assets]: ${message}`),
      });

      try {
        body = await pipeline.rewriteMarkdown(body);

        if (coverRef && !isRemoteRef(coverRef)) {
          const resolved = await pipeline.resolve(coverRef);
          if (/^https?:\/\//i.test(resolved)) {
            coverImageUrl = resolved;
          }
        }
      } catch (error) {
        logger.error(`${rel} [assets]: ${(error as Error).message}`);
        assetStepFailed = true;
      }

      // Persist whatever uploads succeeded even if a later one failed - an
      // unrelated image shouldn't have to re-upload on the next run.
      assetFingerprints = pipeline.seenHashes;
      totalCalls += pipeline.uploads;

      if (pipeline.dirty) {
        deployments.assets = pipeline.assetMap;
        frontmatterDirty = true;
      }
    } else if (findImageRefs(body).some((ref) => !isRemoteRef(ref))) {
      logger.warn(
        `${rel}: references local images but no assetUploader is configured - ` +
          'they will not resolve on remote platforms',
      );
    }

    // Cover image fallbacks when the pipeline did not produce a URL.
    if (!coverImageUrl && coverRef && isRemoteRef(coverRef)) {
      coverImageUrl = coverRef;
    } else if (!coverImageUrl && coverRef && siteUrl) {
      coverImageUrl = new URL(coverRef.replace(/^\//, ''), withTrailingSlash(siteUrl)).href;
    }

    if (!assetStepFailed) {
      // 4. Append the visible backlink footer, then hash exactly what
      //    will be sent (so a changed canonical URL forces a re-sync).
      body = appendBacklink(body, { title, canonicalUrl }, backlink);
      const contentHash = generateContentHash(title, body, assetFingerprints);
      const isModified = contentHash !== deployments.contentHash;

      const post: BlogPost = {
        filePath,
        slug,
        title,
        content: body,
        canonicalUrl,
        coverImageUrl,
        tags: normalizeTags(data.tags),
        series: normalizeText(data.series),
        // Reuses the post's own SEO description - most blogs already fill
        // this in for their <meta name="description">, so there is usually
        // nothing new to write for syndication to work.
        description: normalizeText(data.description),
        data,
      };

      // 5. Run only the providers this post opted into.

      for (const provider of targets) {
        const ctx: SyncContext = { post, deployments, contentHash, isModified };

        let result;
        try {
          result = await provider.sync(ctx);
        } catch (error) {
          logger.error(`${rel} -> ${provider.name}: ${(error as Error).message}`);
          continue;
        }

        logger.info(`${rel} -> ${provider.name}: ${result.message}`);

        if (result.action === 'skipped') {
          continue;
        }

        // A real request happened: persist state, then throttle.
        if (result.remoteId !== undefined) {
          deployments[provider.name] = result.remoteId;
          frontmatterDirty = true;
        }
        if (deployments.contentHash !== contentHash) {
          deployments.contentHash = contentHash;
          frontmatterDirty = true;
        }

        totalCalls += 1;
        // Rate-limit guard: pause after every API call so consecutive
        // requests (next provider, or next file) stay spaced out.
        await delay(requestDelayMs);
      }
    }

    // 6. Write the updated frontmatter back to the original file.
    if (frontmatterDirty) {
      data.deployments = deployments;
      await writeFile(filePath, matter.stringify(parsed.content, data), 'utf8');
      logger.info(`${rel}: frontmatter updated`);
    }
  }

  logger.info(`finished - ${totalCalls} API call(s) made.`);
  return { totalCalls };
}
