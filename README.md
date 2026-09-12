<p align="center">
  <img src=".github/assets/hero.svg" alt="astro-syndicate" width="100%">
</p>

[![Release](https://github.com/SlashGordon/astro-syndicate/actions/workflows/release.yml/badge.svg)](https://github.com/SlashGordon/astro-syndicate/actions/workflows/release.yml)

[![CI](https://github.com/SlashGordon/astro-syndicate/actions/workflows/ci.yml/badge.svg)](https://github.com/SlashGordon/astro-syndicate/actions/workflows/ci.yml)

# astro-syndicate

An Astro integration that syndicates Markdown/MDX blog posts to external platforms (dev.to, with Hashnode and Medium designed to slot in later) as part of `astro build`.

It hashes each post's title and content, compares that hash against what was stored the last time it synced, and only calls a platform's API when something changed. Posts opt in via `syndicate: true` in frontmatter. Local images can be uploaded to a host of your choosing and rewritten to absolute URLs before a post goes out, since dev.to has no reliable image-upload API of its own.

Every new post syncs as a draft on dev.to (`published: false`) by default - nothing goes live until you change that yourself. Set `DevToProvider`'s `published: true` (or `DEVTO_PUBLISHED=true`) to have new posts publish immediately instead; either way, an update to an already-synced post never touches that field, so a post you've published by hand stays published.

`canonical_url` is metadata dev.to uses for SEO, not a link it shows readers - so by default the integration also appends a short, visible "originally published on [yourdomain](...)" line to the end of every post's body. Set `backlink: false` in `astro.config.mjs` to turn it off, or pass a function to write your own.

## How it works

1. Something triggers a sync - either `astro build` finishing, or a plain script call. Either way, the actual work is one call to `runSyndication()`, which scans `src/content/blog/` for `.md` / `.mdx` files.
2. For each file with `syndicate: true`, it parses frontmatter with `gray-matter`, resolves any local images through an `AssetUploader`, and computes a SHA-256 hash of the title, content, and referenced image fingerprints.
3. It compares that hash to `deployments.contentHash` in the frontmatter:
   - no `deployments.<provider>` yet: creates a new post
   - hash changed: updates the existing post
   - hash unchanged: skips the API call
4. It rewrites the frontmatter with the new provider id and hash, so the next run knows what's already in sync.

`syndication.config.ts` is the one place that configures *what* to syndicate and how (providers, asset uploader, site URL); `src/integrations/syndication/` has the implementation, and `types.ts` defines the `SyndicationProvider` and `AssetUploader` interfaces a new platform or host needs to implement.

### Two ways to trigger it

- **During the build** (the default here): `astro.config.mjs` registers `syndication(syndicationOptions)`, which runs in the `astro:build:done` hook. Simplest option, and the right one when your build already happens at/after deploy - there's no real gap between "built" and "live".
- **After deploy, as its own step**: call `runSyndication()` directly - a plain async function, no Astro involved - from anywhere, e.g. `npm run syndicate` (`scripts/syndicate.ts`), wired into CI to run *after* your host confirms the deploy succeeded. Pick this when there IS a gap between build and deploy (a separate upload step, CDN propagation, a review stage), so dev.to only ever sees image and canonical URLs that are already live, not a build's worth of assets that haven't gone anywhere yet.

Both read the exact same `syndicationOptions` from `syndication.config.ts`, so there's one place to configure either way. Running both isn't harmful (the content-hash skip makes a redundant pass a no-op) - just redundant.

### Only run in production

`syndicationOptions.enabled` gates the whole run - the current config sets it to `process.env.NODE_ENV === 'production'`, so a local `astro build`, a PR preview, or plain CI never syndicates anything. Match the check to your host (Netlify: `CONTEXT`, Vercel: `VERCEL_ENV`, ...) rather than assuming `NODE_ENV`.

### Frontmatter fields it reads

| Field | Required | Notes |
| --- | --- | --- |
| `syndicate` | yes | Must be `true`, or the file is skipped entirely. |
| `title` | yes | |
| `slug` | no | Defaults to the file name. |
| `canonicalUrl` | no | Defaults to `${siteUrl}/blog/${slug}/`. |
| `coverImage` | no | Local path or absolute URL; sent as dev.to's `main_image`. |
| `description` | no | Reused as-is - most posts already set this for their own SEO `<meta>` tag. |
| `series` | no | Groups posts on dev.to; created automatically if it doesn't exist. |
| `tags` | no | Array or comma-separated string. dev.to allows at most 4; extra tags are dropped and the build log says so. |
| `deployments` | managed | Written by the integration - don't hand-edit it. |

### MDX posts with Astro-native images

A `.mdx` post commonly pulls images in through JavaScript rather than a plain `![alt](src)` string - `astro:assets`' own `<Image src={imported} />`, or a gallery component's `images={[{ src, alt }]}` array. Sent to a provider as-is, none of that resolves: dev.to doesn't run your build, so it just sees the literal `import ...` lines and an empty custom tag.

Before the regular image pipeline runs, the integration rewrites the patterns below back into plain Markdown so they go through it exactly like a hand-written `![alt](src)` would:

- `import name from './local/image.jpg'` - the import line is removed; `name` becomes resolvable everywhere below.
- `<Image src={name} alt="..." />` (`astro:assets`) → `![alt](./local/image.jpg)`.
- `<AnyComponent images={[{ src: name, alt: "..." }, ...]} />` (any capitalised component, e.g. a gallery grid) → one `![alt](...)` per entry. A bare identifier array (`images={[a, b]}`) works too.
- Every other top-level `import` line is stripped regardless, so no leftover Astro/JS syntax reaches a provider even when it isn't image-related.

A folder-driven component (`<MapGallery folderPath="..." />` and similar) is different: the list of images it renders is never written in the source at all, some integration resolves it from disk at build time. This package can't know that convention, so pass `resolveFolderImages` in `syndicationOptions` to supply it yourself:

```ts
import fg from 'fast-glob';
import { join } from 'node:path';

export const syndicationOptions: SyndicationOptions = {
  // ...
  resolveFolderImages: async (folderPath) => {
    const dir = join(process.cwd(), 'src/assets', folderPath.replace(/^images\//, ''));
    const files = await fg('*.{jpg,jpeg,png,webp}', { cwd: dir, absolute: true });
    return files.sort().map((path) => ({ path }));
  },
};
```

Without this option, a `folderPath` component is removed from the body sent to a provider and a warning is logged, rather than guessing at which files it would have shown.

### Choosing an asset host

`assetUploader` decides where a post's local images end up. Three ship with the package:

| Uploader | How it resolves an image | When to use it |
| --- | --- | --- |
| `CloudinaryUploader` | Uploads the file to Cloudinary via an unsigned preset. | No public site to point at yet, or images live outside `distDir`/`publicDir` entirely. |
| `SiteUrlUploader` | Rewrites to `${siteUrl}/<path>`, no upload at all. | Images are copied verbatim into Astro's `public/` dir, so the deployed path is the same as the source path. |
| `DistHtmlUploader` | Reads the post's own already-built page and reuses whatever URL Astro gave that image there. | Images go through `astro:assets` or a gallery integration (so their deployed filename is a build-time content hash `SiteUrlUploader` can't predict), **and** syndication runs *after* your host has deployed - see "Two ways to trigger it" above. |

`DistHtmlUploader` needs `distDir` (the built output, still on disk at that point) and `siteUrl`; `pagePath` maps a slug to its URL path when posts don't render at the plain `/<slug>/` root:

```ts
import { DistHtmlUploader } from 'astro-syndicate';

assetUploader: new DistHtmlUploader({
  distDir: new URL('./dist', import.meta.url).pathname,
  siteUrl: SITE,
  pagePath: (slug) => `post/${slug}`, // for a site where posts render at /post/<slug>/
}),
```

It matches each image against the `<img>` tags inside that page's `<main>` or `<article>`: first by exact `alt` text, then by position among whichever tags no earlier image in the same post already claimed. A post where every image sets a distinct `alt` (the common case) matches exactly; images sharing identical or empty `alt` text fall back to document order, which usually - but not always - lines up.

**Always set `alt` text on your images.** It's the one signal in this whole process that identifies an image by *what it is* rather than *where it happens to sit* - everything else (positional fallback, the plausibility check below) is a best-effort guess that only exists because `alt` wasn't there to make the match exact. Two images in the same post sharing an `alt` (including two left empty) both fall onto positional matching, which a reordered paragraph or an image added earlier in the post can quietly throw off.

Pass `log` to see which strategy each image actually used, and to catch a mismatch between how many local images a post's Markdown references and how many `<img>` tags were actually found - a strong signal something didn't render the way the post expects, worth checking before trusting the URLs that came back:

```ts
new DistHtmlUploader({
  distDir: new URL('./dist', import.meta.url).pathname,
  siteUrl: SITE,
  log: (message) => console.log(`[dist-html] ${message}`),
});
// "first.jpg" on "my-post": matched by alt text "First real photo"
// "second.jpg" on "my-post": no alt match (alt: <none>), fell back to position 1 - set a unique alt on this image to make the match exact
// plausibility check failed for "my-post": its Markdown references 5 local image(s), but 3 <img> tag(s) were found in the built page's <main>/<article> - matches below may be wrong; double-check alt text and that every image actually rendered
```

### Undoing a sync

`resetContentDir(contentDir)` / `clearDeployments(filePath)` (from `src/integrations/syndication/reset.ts`, exported from the package) strip the `deployments` block back out of a post's frontmatter, restoring it to its pre-sync state. `scripts/reset-content.ts` is a small CLI wrapper around it:

```bash
npm run reset-content -- src/content/blog        # preview with: ... -- src/content/blog --dry-run
```

This can't delete anything on dev.to - the API has no endpoint for that, only the web dashboard does - but it prints every dev.to id it finds so you know exactly what to remove there.

## Development

```bash
npm install
npm run dev      # astro dev
npm run build    # astro build - this is what triggers syndication
```

## Testing

```bash
npm test                  # everything
npm run test:unit         # hashing, the image parser, providers, uploaders, canonical-URL logic
npm run test:integration  # a real `astro build` against fixture posts, network mocked
```

The unit tests in `tests/unit/` cover the logic most likely to hide a bug: SHA-256 hashing (including how image fingerprints fold in), the regex-based image scanner (code-fence and inline-code exclusion, the `data-src` vs. `src` distinction), frontmatter normalization (tags, series, description), the backlink footer, the dev.to create/update/skip decision table, the 4-tag cap, the canonical-URL precedence rules, both asset uploaders, and `runSyndication()` called standalone (no Astro at all) - including the `enabled` gate and a regression test for a real bug: `gray-matter` caches parses globally by raw input string, so mutating its returned `data` in place had corrupted that cache for any other byte-identical file. Another regression test covers an update never sending `published: false`, since dev.to's API reverts an already-published post to draft when it sees that.

`tests/integration/build.test.ts` runs Astro's actual programmatic `build()` API against a throwaway fixture site: a Markdown post with headings, a table, a blockquote, three kinds of image reference, a lazy-loading `data-src` decoy, and two images embedded in code samples that must survive untouched, plus an MDX post. `fetch` is mocked so dev.to and Cloudinary calls never leave the machine. The build runs twice, covering the full lifecycle: create on the first run, skip once nothing changed, update once the MDX post is edited.

## License

MIT © [SlashGordon](https://www.slashgordon.link).

## Support

If this integration saves you time, consider buying me a coffee. It helps keep
the maintenance going.

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-SlashGordon-FFDD00?logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/SlashGordon)
