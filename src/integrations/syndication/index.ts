import { fileURLToPath } from 'node:url';

import type { AstroIntegration } from 'astro';

import { runSyndication, type SyndicationOptions } from './run';

/**
 * Astro integration wrapper around `runSyndication()`: it runs the same sync
 * pass, triggered by `astro:build:done` instead of a manual script call.
 *
 * Prefer this when your `astro build` happens right at (or after) deploy, so
 * whatever it syndicates is already live. If there's a real gap between
 * build and deploy - a separate upload/publish step, a CDN propagation
 * delay - call `runSyndication()` yourself as its own step once that's
 * finished instead of registering this integration; see the package README.
 */
export function syndication(options: SyndicationOptions): AstroIntegration {
  // Captured in `astro:config:done`, consumed in `astro:build:done`.
  let projectRoot = process.cwd();
  let configuredSite: string | undefined;

  return {
    name: 'astro-syndication',
    hooks: {
      'astro:config:done': ({ config }) => {
        projectRoot = fileURLToPath(config.root);
        configuredSite = config.site;
      },

      'astro:build:done': async ({ logger }) => {
        await runSyndication({
          ...options,
          projectRoot,
          siteUrl: options.siteUrl ?? configuredSite,
          logger,
        });
      },
    },
  };
}

export { runSyndication } from './run';
export type { SyndicationOptions, RunSyndicationOptions, RunSyndicationResult, SyndicationLogger } from './run';
export { resolveCanonicalUrl, collectMarkdownFiles } from './resolve';
export { appendBacklink } from './backlink';
export type { BacklinkOption, BacklinkFormatter, BacklinkPost } from './backlink';
export { clearDeployments, resetContentDir } from './reset';
export type { ResetOptions, ResetResult } from './reset';
export type {
  SyndicationProvider,
  SyncContext,
  SyncResult,
  BlogPost,
  Deployments,
  AssetUploader,
  AssetSource,
  UploadedAsset,
} from './types';
export { DevToProvider } from './providers/devto';
export { SiteUrlUploader } from './uploaders/site-url';
export { CloudinaryUploader } from './uploaders/cloudinary';
