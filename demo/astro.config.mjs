import { defineConfig } from 'astro/config';

import { syndication } from 'astro-syndicate';

import { SITE, syndicationOptions } from './syndication.config';

// https://astro.build/config
export default defineConfig({
  site: SITE,
  integrations: [
    // Runs inside `astro build` (astro:build:done) - see
    // `syndication.config.ts` for the actual provider/uploader setup, shared
    // with `scripts/syndicate.ts` for the "syndicate after deploy" pattern.
    syndication(syndicationOptions),
  ],
});
