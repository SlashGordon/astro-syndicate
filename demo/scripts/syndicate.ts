/**
 * Run syndication as its own step, separate from `astro build` entirely.
 *
 * The Astro integration (`syndication()` in `astro.config.mjs`) runs inside
 * the build, in `astro:build:done`. That's simplest, and fine when your
 * build already happens at/after deploy. But if there's a real gap - a
 * separate deploy step, CDN propagation, a review stage - anything
 * syndicated during the build would point at images and canonical URLs that
 * aren't live yet. This script runs as a plain, standalone step instead,
 * meant to be wired into CI *after* your host confirms the deploy succeeded
 * - see `.github/workflows/cloudflare-pages.yml` /
 * `.gitea/workflows/cloudflare-pages.yml`.
 *
 * It overrides `syndication.config.ts`'s asset uploader: that config uses
 * `CloudinaryUploader` because during a build the site isn't live yet, so
 * there's nothing to hotlink. Here, run *after* deploy, `demo/public` is
 * already served at `SITE_URL` - so `SiteUrlUploader` just rewrites image
 * paths to that, no upload step (or Cloudinary account) needed at all.
 *
 * Usage: npm run syndicate --prefix demo
 */
import { fileURLToPath } from 'node:url';

import { runSyndication, SiteUrlUploader } from 'astro-syndicate';

import { syndicationOptions } from '../syndication.config';

// Cloudflare Pages' default production URL for the `astro-syndicate-demo`
// project (see the `projectName` in cloudflare-pages.yml). Swap this for
// your own custom domain once you set one up.
const SITE_URL = 'https://astro-syndicate-demo.pages.dev';

async function main(): Promise<void> {
  const result = await runSyndication({
    ...syndicationOptions,
    projectRoot: process.cwd(),
    siteUrl: SITE_URL,
    assetUploader: new SiteUrlUploader({
      siteUrl: SITE_URL,
      publicDir: fileURLToPath(new URL('../public', import.meta.url)),
    }),
    logger: console,
  });

  if (result.totalCalls === 0) {
    console.log('nothing to do - every post was already in sync.');
  }
}

main();
