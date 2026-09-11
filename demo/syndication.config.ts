import { CloudinaryUploader, DevToProvider, type SyndicationOptions } from 'astro-syndicate';
// import { SiteUrlUploader } from 'astro-syndicate';

// This is a placeholder - nothing under demo/public is actually deployed
// here. That's fine for `canonical_url` (dev.to just stores it), but NOT
// fine for images: see the uploader choice below and demo/README.md.
export const SITE = 'https://example.com';

/**
 * Single source of truth for what this demo syndicates and how - shared by
 * `astro.config.mjs` (syncs inside `astro:build:done`, see
 * `.github/workflows/deploy.yml`) and `scripts/syndicate.ts` (syncs as its
 * own step after a real deploy, see `.github/workflows/cloudflare-pages.yml`).
 * See the root README's "Two ways to trigger it" for when to pick which.
 */
export const syndicationOptions: SyndicationOptions = {
  providers: [
    new DevToProvider({
      apiKey: process.env.DEVTO_API_KEY,
      // organizationId: 12345,
      // Draft by default. Set DEVTO_PUBLISHED=true once you want new posts
      // to go live on dev.to immediately instead of staying a draft.
    }),
  ],

  // Real upload, works right now with a free account - no deploy needed.
  // See demo/README.md for the 2-minute Cloudinary setup.
  assetUploader: new CloudinaryUploader({
    cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? '',
    uploadPreset: process.env.CLOUDINARY_UPLOAD_PRESET ?? '',
    folder: 'astro-syndicate-demo',
  }),

  // Zero-infra alternative: no upload, just rewrites paths to `${SITE}/...`.
  // Only works once `demo/public` is actually deployed at SITE.
  // import { fileURLToPath } from 'node:url';
  // assetUploader: new SiteUrlUploader({
  //   siteUrl: SITE,
  //   publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  // }),

  siteUrl: SITE,

  // No `DEVTO_API_KEY` during the build step means this no-ops there - see
  // `.github/workflows/cloudflare-pages.yml`, which only sets it on the
  // dedicated syndicate step, after Cloudflare confirms the deploy.
  enabled: Boolean(process.env.DEVTO_API_KEY),

  requestDelayMs: 2000,
};
