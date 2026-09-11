import { DevToProvider } from './src/integrations/syndication/providers/devto';
import { CloudinaryUploader } from './src/integrations/syndication/uploaders/cloudinary';
import type { SyndicationOptions } from './src/integrations/syndication/run';

export const SITE = 'https://www.slashgordon.link';

/**
 * Single source of truth for what to syndicate and how - used by both:
 *
 *  - `astro.config.mjs`, which runs this inside `astro build` via the
 *    `syndication()` integration. The simplest option, and the right one
 *    when your build already happens at/after deploy, with no real gap
 *    between "built" and "live".
 *
 *  - `scripts/syndicate.ts`, which runs the exact same options as their own
 *    step, typically wired into CI *after* deploy succeeds. Pick this one
 *    when there IS a gap - a separate upload step, CDN propagation, a
 *    review/approval stage - so dev.to only ever sees image and canonical
 *    URLs that are already live, instead of a build's worth of assets that
 *    haven't been uploaded anywhere yet.
 *
 * Only one of the two should actually be enabled at a time; running both
 * isn't harmful (the content-hash skip makes a redundant pass a no-op), but
 * it does mean paying for the check twice.
 */
export const syndicationOptions: SyndicationOptions = {
  providers: [
    // Reads DEVTO_API_KEY from the environment when `apiKey` is omitted.
    new DevToProvider({
      apiKey: process.env.DEVTO_API_KEY,
      // organizationId: 12345,
    }),
  ],

  assetUploader: new CloudinaryUploader({
    cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? '',
    uploadPreset: process.env.CLOUDINARY_UPLOAD_PRESET ?? '',
    folder: 'blog-syndication',
  }),

  siteUrl: SITE,

  // The environment check: only ever run in production, never from a local
  // build, a PR preview, or plain CI. Match this to your host -
  // Netlify sets CONTEXT, Vercel sets VERCEL_ENV, and so on.
  //
  // The `DEVTO_API_KEY` check on top of that is specific to this repo's own
  // `astro build` (used as a self-check in CI's `lib` job, with no real blog
  // behind it) so that build doesn't fail for lack of a live key. A real
  // site wired up to a real host wouldn't need it.
  enabled: process.env.NODE_ENV === 'production' && Boolean(process.env.DEVTO_API_KEY),
};
