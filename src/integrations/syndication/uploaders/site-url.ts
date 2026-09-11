import { relative } from 'node:path';

import type { AssetSource, AssetUploader, UploadedAsset } from '../types.js';
import { withTrailingSlash } from '../utils.js';

export interface SiteUrlUploaderOptions {
  /** Public base URL of your deployed site, e.g. `https://example.com`. */
  siteUrl: string;
  /** Absolute path of the directory that maps to the site root (Astro's `public/`). */
  publicDir: string;
}

/**
 * Zero-infrastructure strategy: performs no upload at all. It rewrites each
 * local image to the absolute URL it will have on your own site once deployed.
 *
 * dev.to and Hashnode hotlink external images, so for most blogs this is
 * enough and keeps a single canonical image URL. Caveats:
 *  - your site must actually be deployed for the links to resolve;
 *  - only files under `publicDir` can be mapped;
 *  - remote platforms cache images at publish time, so replacing a file at the
 *    same path may not refresh the copy they already fetched.
 */
export class SiteUrlUploader implements AssetUploader {
  public readonly name = 'site-url';

  readonly #siteUrl: string;
  readonly #publicDir: string;

  constructor(options: SiteUrlUploaderOptions) {
    this.#siteUrl = withTrailingSlash(options.siteUrl);
    this.#publicDir = options.publicDir;
  }

  public setup(): void {
    if (!/^https?:\/\//i.test(this.#siteUrl)) {
      throw new Error('[syndication/assets] SiteUrlUploader needs an absolute siteUrl');
    }
  }

  public async upload(asset: AssetSource): Promise<UploadedAsset> {
    const rel = relative(this.#publicDir, asset.absPath).split(/[\\/]+/).join('/');
    if (rel.startsWith('..')) {
      throw new Error(
        `[syndication/assets] ${asset.ref} is outside publicDir; ` +
          `SiteUrlUploader can only map files under ${this.#publicDir}`,
      );
    }
    return { url: new URL(rel, this.#siteUrl).href };
  }
}
