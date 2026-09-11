import { defineConfig } from 'astro/config';

import { syndication } from './src/integrations/syndication/index.ts';
import { SITE, syndicationOptions } from './syndication.config.ts';

// https://astro.build/config
export default defineConfig({
  // `site` is reused as the base for each post's canonical_url.
  site: SITE,

  // This root project is only a dogfood/smoke-test site for the integration
  // itself (there's no real page here to deploy) - keep its build output out
  // of `./dist`, which is reserved for the published package's compiled JS.
  outDir: './.astro-build',

  integrations: [
    // Runs inside `astro build` (astro:build:done). If your build happens
    // separately from deploy - so posted images/canonical URLs would point
    // at content that isn't live yet - run `scripts/syndicate.ts` as its own
    // step *after* deploy instead, and drop this integration. Either way,
    // `syndication.config.ts` is the one place that actually configures it.
    syndication(syndicationOptions),
  ],
});
