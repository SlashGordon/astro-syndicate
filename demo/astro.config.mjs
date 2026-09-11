import { defineConfig } from 'astro/config';

import { syndication } from '../src/integrations/syndication/index.ts';
import { DevToProvider } from '../src/integrations/syndication/providers/devto.ts';
import { CloudinaryUploader } from '../src/integrations/syndication/uploaders/cloudinary.ts';
// import { SiteUrlUploader } from '../src/integrations/syndication/uploaders/site-url.ts';

// This is a placeholder - nothing under demo/public is actually deployed
// here. That's fine for `canonical_url` (dev.to just stores it), but NOT
// fine for images: see the uploader choice below and demo/README.md.
const SITE = 'https://example.com';

// https://astro.build/config
export default defineConfig({
  site: SITE,
  integrations: [
    syndication({
      providers: [
        new DevToProvider({
          apiKey: process.env.DEVTO_API_KEY,
          // organizationId: 12345,
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

      requestDelayMs: 2000,
    }),
  ],
});
