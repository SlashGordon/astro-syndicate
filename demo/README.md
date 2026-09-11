# Demo: syndicating to real dev.to

A minimal, working Astro site to test the syndication integration against
the actual dev.to API - not a mock. It has two posts, both with local
images and a cover image:

- `src/content/blog/how-we-syndicate-posts.md`
- `src/content/blog/local-first-image-pipeline.mdx`

Every post it creates is a draft (`published: false`). Nothing goes live on
its own - set `DEVTO_PUBLISHED=true` if you want new posts to publish
immediately instead (see [CI / deploy](#ci--deploy) below).

## Run it

You need two things:

- a dev.to API key: <https://dev.to/settings/extensions>
- a Cloudinary account for image uploads (free tier is enough):
  1. Sign up at <https://cloudinary.com>. Your cloud name is shown at the top of the console dashboard.
  2. Click the gear icon (Settings) → the **Upload** tab → **Upload presets** → **Add upload preset**.
  3. Set **Signing Mode** to **Unsigned** - that's what lets this integration upload without an API secret.
  4. Name it something you'll recognize (e.g. `astro-syndicate-demo`) and save. That name is your upload preset.

  An unsigned preset lets anyone who knows its name upload to your account, rate-limited by your plan. Fine for this demo; don't reuse the name anywhere public-facing later.

This demo depends on `astro-syndicate` via `file:..`, so it needs the package built first, then its own install (only needed once, or whenever the package's dependencies change):

```bash
# from the repo root
npm run build:lib
npm install --prefix demo
```

```bash
# from the repo root
DEVTO_API_KEY=your_key_here \
CLOUDINARY_CLOUD_NAME=your_cloud_name \
CLOUDINARY_UPLOAD_PRESET=your_preset_name \
npm run demo:build
```

Without `DEVTO_API_KEY` set, the build still succeeds - it just skips syndication entirely (that's what lets CI build this demo on every push without needing real credentials).

Watch the build log: it lists each image upload, then each dev.to
create/update/skip. Afterward, open the two post files - the integration
will have written a `deployments:` block into their frontmatter with the
dev.to article id and a content hash.

Run the same command again without changing anything: both posts should log
as unmodified, with zero image uploads and zero dev.to requests.

Edit a post's body (or an image under `public/`) and run it a third time:
only the changed post should send a request, and it'll be a `PUT`, not a new
draft.

To start over:

```bash
npm run demo:reset            # preview with: npm run demo:reset -- --dry-run
```

This clears the `deployments:` block from every post under `demo/src/content/blog/`,
so the next build treats them as brand new. It prints the dev.to id each post
had, but can't delete anything on dev.to itself - the API has no endpoint for
that, only the web dashboard does. Delete the listed drafts there:
<https://dev.to/dashboard>.

## About the images

`astro.config.mjs` uses `CloudinaryUploader` by default: it uploads each
local image and gets back a real, working URL, so there's nothing to
deploy first. The commented-out alternative, `SiteUrlUploader`, doesn't
upload anywhere - it just rewrites `/images/foo.png` to `${site}/images/foo.png`,
which only resolves once `demo/public` is deployed at a real `site` URL. If
you'd rather use that (no Cloudinary account needed) once you have somewhere
to deploy to, swap the two in `astro.config.mjs` and point `SITE` at it.

If you ran this demo before the switch to `CloudinaryUploader`, the post
frontmatter may still list image URLs under the `https://example.com`
placeholder - those never resolved on dev.to. Nothing to clean up by hand:
the asset cache is keyed per uploader, so the next build re-uploads through
Cloudinary automatically and sends dev.to a `PUT` with the corrected images.

## CI / deploy

Four sample pipelines - a GitHub Actions and a Gitea Actions version of each
of the two trigger patterns documented in the root README's "Two ways to
trigger it":

- **`deploy.yml`** - install, build (which triggers syndication inline via
  `astro:build:done`, since `DEVTO_API_KEY` is set for that step), then
  deploy the output. Simplest option.
- **`cloudflare-pages.yml`** - build with *no* `DEVTO_API_KEY` set (so
  `syndication.config.ts`'s `enabled` gate keeps the build to static pages
  only), deploy that output to Cloudflare Pages, then run
  `npm run syndicate --prefix demo` (`scripts/syndicate.ts`) as its own step
  *after* the deploy succeeds - so dev.to only ever sees canonical URLs and
  cover images that are already live. Cloudflare Pages is just the example
  host here; swap that one deploy step for whatever you use and keep the
  syndicate step as-is. The GitHub version deploys via the official
  `cloudflare/pages-action`; the Gitea version uses the Wrangler CLI
  directly, since a plain `run:` step works the same everywhere.

  Unlike `syndication.config.ts` (which the *inline* pipeline uses as-is),
  `scripts/syndicate.ts` swaps `CloudinaryUploader` for `SiteUrlUploader`:
  once Cloudflare has deployed `demo/public`, images are already
  live there, so there's nothing to upload and no Cloudinary account needed
  for this pipeline at all. It points `SiteUrlUploader` at Cloudflare Pages'
  default `https://astro-syndicate-demo.pages.dev` URL - update the
  `SITE_URL` constant in that file if you set up a custom domain.

`deploy.yml` needs `DEVTO_API_KEY`, `CLOUDINARY_CLOUD_NAME`,
`CLOUDINARY_UPLOAD_PRESET`, and `DEVTO_PUBLISHED`. `cloudflare-pages.yml`
needs only `DEVTO_API_KEY` and `DEVTO_PUBLISHED` from that list (no
Cloudinary secrets - see above), plus `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`.

`DEVTO_PUBLISHED` defaults to `false` - every synced post stays a draft,
matching local runs. Set it to `'true'` in the pipeline once you're
confident enough to let new posts go live on dev.to the moment they're
created; it never touches an already-published post on a later update (see
the CRITICAL note on `DevToProvider` for why that field is create-only).

Both files build `astro-syndicate` from source first (`npm run build:lib`)
since this demo depends on it via `file:..` in the same repo - drop that
step in your own project, where `npm ci` already installs a published
version straight from npm.

## Rate limits

dev.to throttles repeated requests, including failed ones - if you rerun the
build several times in quick succession (for example, while debugging a bad
API key) you may see a `429 Too Many Requests` response. It's not a bug,
just back off for a bit and try again.
