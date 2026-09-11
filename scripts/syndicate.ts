/**
 * Run syndication as its own step, separate from `astro build` entirely.
 *
 * The Astro integration (`syndication()` in `astro.config.mjs`) runs inside
 * the build, in `astro:build:done`. That's simplest, and fine when your
 * build already happens at/after deploy. But if there's a real gap - a
 * separate upload step, CDN propagation, a review stage - anything
 * syndicated during the build would point at images and canonical URLs that
 * aren't live yet. This script runs the identical options
 * (`syndication.config.ts`) as a plain, standalone step instead, meant to be
 * wired into CI *after* your host confirms the deploy succeeded - a GitHub
 * Actions job with `needs: deploy`, a deploy-succeeded webhook, etc.
 *
 * Usage: tsx scripts/syndicate.ts
 */
import { runSyndication } from '../src/integrations/syndication/run';
import { syndicationOptions } from '../syndication.config';

async function main(): Promise<void> {
  const result = await runSyndication({
    ...syndicationOptions,
    projectRoot: process.cwd(),
    logger: console,
  });

  if (result.totalCalls === 0) {
    console.log('nothing to do - every post was already in sync.');
  }
}

main();
