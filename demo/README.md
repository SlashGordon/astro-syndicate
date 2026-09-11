# Demo: syndicating to real dev.to

A minimal, working Astro site to test the syndication integration against
the actual dev.to API - not a mock. It has two posts, both with local
images and a cover image:

- `src/content/blog/how-we-syndicate-posts.md`
- `src/content/blog/local-first-image-pipeline.mdx`

Every post it creates is a draft (`published: false`). Nothing goes live on
its own.

## Run it

You need two things:

- a dev.to API key: <https://dev.to/settings/extensions>
- a Cloudinary account for image uploads (free tier is enough):
  1. Sign up at <https://cloudinary.com>. Your cloud name is shown at the top of the console dashboard.
  2. Click the gear icon (Settings) → the **Upload** tab → **Upload presets** → **Add upload preset**.
  3. Set **Signing Mode** to **Unsigned** - that's what lets this integration upload without an API secret.
  4. Name it something you'll recognize (e.g. `astro-syndicate-demo`) and save. That name is your upload preset.

  An unsigned preset lets anyone who knows its name upload to your account, rate-limited by your plan. Fine for this demo; don't reuse the name anywhere public-facing later.

```bash
# from the repo root
DEVTO_API_KEY=your_key_here \
CLOUDINARY_CLOUD_NAME=your_cloud_name \
CLOUDINARY_UPLOAD_PRESET=your_preset_name \
npm run demo:build
```

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

`astro.config.mjs` uses `CloudinaryUploader` by default: it actually uploads
each local image and gets back a real, working URL, so there's nothing to
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

## Rate limits

dev.to throttles repeated requests, including failed ones - if you rerun the
build several times in quick succession (for example, while debugging a bad
API key) you may see a `429 Too Many Requests` response. It's not a bug,
just back off for a bit and try again.
