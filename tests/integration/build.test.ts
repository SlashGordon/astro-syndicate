/**
 * Integration test: runs a real `astro build` (Astro's programmatic `build()`
 * API, in-process) against a throwaway fixture site containing a "complex"
 * Markdown post and a "complex" MDX post, with `fetch` mocked so no request
 * ever leaves the machine. This exercises the full `astro:build:done` hook
 * exactly as production would, not just the hook function called directly.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import matter from 'gray-matter';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'astro';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { appendBacklink } from '../../src/integrations/syndication/backlink';
import { generateContentHash } from '../../src/integrations/syndication/hashing';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
// tests/integration -> project root, so the fixture keeps access to the
// real node_modules (Astro needs to resolve itself via upward lookup).
const PROJECT_ROOT = join(TEST_DIR, '..', '..');
const SYNDICATION_SRC = join(PROJECT_ROOT, 'src', 'integrations', 'syndication');
const SITE_ROOT = join(PROJECT_ROOT, '.tmp-integration-site');

const BLOG_DIR = join(SITE_ROOT, 'src', 'content', 'blog');
const MD_POST = join(BLOG_DIR, 'launch-announcement.md');
const MDX_POST = join(BLOG_DIR, 'changelog.mdx');
const DRAFT_POST = join(BLOG_DIR, 'draft-do-not-sync.md');

const MD_BODY = `# We shipped it

We spent **three months** on this. Here is the architecture:

![architecture diagram](./images/diagram.png "System overview")

> This rewrite touches every part of the sync engine.

<img data-src="./images/lazy-placeholder.png" src="./images/diagram.png" alt="Architecture, lazy-load decoy">

An image already hosted elsewhere, must not be re-uploaded:

![existing](https://cdn.existing.example/existing-photo.jpg)

## Highlights

1. Faster builds
2. Fewer flaky syncs
3. A real test suite

| Area | Status |
| --- | --- |
| Sync engine | Rewritten |
| Tests | Added |

A code sample that *shows* Markdown image syntax as an example must not be touched:

\`\`\`md
![example](./should-not-upload.png)
\`\`\`

And inline: \`![inline](./also-should-not-upload.png)\` should not be touched either.
`;

const MDX_BODY_V1 = `## What changed

- Rewrote the sync engine.
- Added Cloudinary support.

<Badge>Breaking</Badge>

A before/after comparison:

| Metric | Before | After |
| --- | --- | --- |
| Build time | 12s | 4s |

\`\`\`ts
export const version = '2.0.0';
\`\`\`
`;

const MDX_BODY_V2 = MDX_BODY_V1.replace('4s |', '3s |').replace(
  "export const version = '2.0.0';",
  "export const version = '2.0.1';",
);

/** Real dev.to / Cloudinary calls this run captured, for assertions. */
interface Captured {
  devto: Array<{ method: string; url: string; article: Record<string, unknown> }>;
  cloudinary: Array<{ publicId: string; folder: string | null }>;
}

let nextDevToId = 1000;

function installFetchMock(): Captured {
  const captured: Captured = { devto: [], cloudinary: [] };

  const mock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';

    if (url.startsWith('https://dev.to/api/articles')) {
      const { article } = JSON.parse(String(init.body));
      captured.devto.push({ method, url, article });

      const id = url === 'https://dev.to/api/articles' ? nextDevToId++ : Number(url.split('/').pop());
      return jsonResponse({ id, url: `https://dev.to/x/${id}` });
    }

    if (url === 'https://api.cloudinary.com/v1_1/demo/image/upload') {
      const form = init.body as FormData;
      const publicId = String(form.get('public_id'));
      captured.cloudinary.push({ publicId, folder: form.get('folder') as string | null });
      return jsonResponse({ secure_url: `https://cdn.mock/${publicId}.png` });
    }

    // A static build with no other integrations should never need the network.
    // Fail loudly instead of silently hitting the real internet from a test.
    throw new Error(`unexpected fetch in test: ${method} ${url}`);
  });

  vi.stubGlobal('fetch', mock);
  return captured;
}

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

async function writeAstroConfig(): Promise<void> {
  const src = (...segments: string[]) =>
    JSON.stringify(pathToFileURL(join(SYNDICATION_SRC, ...segments)).href);

  await writeFile(
    join(SITE_ROOT, 'astro.config.mjs'),
    `import { defineConfig } from 'astro/config';
import { syndication } from ${src('index.ts')};
import { DevToProvider } from ${src('providers', 'devto.ts')};
import { CloudinaryUploader } from ${src('uploaders', 'cloudinary.ts')};

export default defineConfig({
  site: 'https://example.com',
  integrations: [
    syndication({
      providers: [new DevToProvider({ apiKey: 'test-key', organizationId: 4242 })],
      assetUploader: new CloudinaryUploader({ cloudName: 'demo', uploadPreset: 'preset' }),
      requestDelayMs: 0,
    }),
  ],
});
`,
  );
}

/** Build a post file with frontmatter that is guaranteed to match `body` exactly. */
function renderPost(frontmatter: Record<string, unknown>, body: string): string {
  return matter.stringify(body, frontmatter);
}

async function writeFixtureSite(): Promise<void> {
  await mkdir(join(SITE_ROOT, 'src', 'pages'), { recursive: true });
  await mkdir(join(BLOG_DIR, 'images'), { recursive: true });
  await mkdir(join(SITE_ROOT, 'public', 'covers'), { recursive: true });

  await writeFile(join(SITE_ROOT, 'src', 'pages', 'index.astro'), '---\n---\n<html><body>ok</body></html>\n');

  // Declare the collection explicitly so Astro doesn't auto-generate it and
  // print a deprecation warning on every build - this has no effect on our
  // integration, which reads the files directly and never goes through
  // Astro's content APIs.
  await writeFile(
    join(SITE_ROOT, 'src', 'content.config.ts'),
    `import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

export const collections = {
  blog: defineCollection({ loader: glob({ pattern: '**/*.md', base: './src/content/blog' }) }),
};
`,
  );

  // Bytes only get hashed, never decoded, so placeholder content is enough.
  await writeFile(join(BLOG_DIR, 'images', 'diagram.png'), Buffer.from('diagram-bytes-v1'));
  await writeFile(join(SITE_ROOT, 'public', 'covers', 'hero.png'), Buffer.from('hero-bytes-v1'));

  await writeAstroConfig();

  await writeFile(
    MD_POST,
    renderPost(
      {
        title: 'Launch Announcement',
        slug: 'launch-announcement',
        syndicate: true,
        coverImage: '/covers/hero.png',
        // `description` doubles as the post's normal SEO <meta> description -
        // syndication reuses it rather than asking for a separate field.
        description: 'We rewrote the sync engine and added a real test suite.',
        series: 'Behind the Scenes',
        tags: ['astro', 'typescript', 'testing', 'devto', 'overflow-tag'],
      },
      MD_BODY,
    ),
  );

  // Pre-seed deployments so this post is already "in sync" on the first
  // build - the run must skip it (zero dev.to calls) until its body changes.
  // Must hash exactly what the real pipeline hashes, backlink footer included.
  const mdxTitle = 'Changelog: v2.0';
  const mdxCanonicalUrl = 'https://example.com/blog/changelog-v2/';
  const mdxBodyWithBacklink = appendBacklink(
    matter(MDX_BODY_V1).content,
    { title: mdxTitle, canonicalUrl: mdxCanonicalUrl },
    undefined,
  );
  const mdxHash = generateContentHash(mdxTitle, mdxBodyWithBacklink);
  await writeFile(
    MDX_POST,
    renderPost(
      {
        title: 'Changelog: v2.0',
        slug: 'changelog-v2',
        syndicate: true,
        deployments: { devto: 555, contentHash: mdxHash },
      },
      MDX_BODY_V1,
    ),
  );

  await writeFile(
    DRAFT_POST,
    renderPost({ title: 'Unfinished Draft', syndicate: false }, 'Not ready yet.\n'),
  );
}

async function readFrontmatter(path: string) {
  return matter(await readFile(path, 'utf8'));
}

describe('astro build with syndication (against mocked dev.to + Cloudinary)', () => {
  let captured: Captured;

  beforeAll(async () => {
    await rm(SITE_ROOT, { recursive: true, force: true });
    await writeFixtureSite();
  });

  afterAll(async () => {
    await rm(SITE_ROOT, { recursive: true, force: true });
  });

  beforeEach(() => {
    captured = installFetchMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('run 1: creates the new post, skips the already-synced one, leaves the draft untouched', async () => {
    const draftBefore = await readFile(DRAFT_POST, 'utf8');
    const mdxBefore = await readFile(MDX_POST, 'utf8');

    await build({ root: SITE_ROOT, logLevel: 'silent' });

    // dev.to: exactly one create (the new post); the pre-synced MDX post skips.
    expect(captured.devto).toHaveLength(1);
    expect(captured.devto[0].method).toBe('POST');
    expect(captured.devto[0].url).toBe('https://dev.to/api/articles');

    const article = captured.devto[0].article;
    expect(article.published).toBe(false);
    expect(article.canonical_url).toBe('https://example.com/blog/launch-announcement/');
    // Cover image resolved through the pipeline to a hosted URL.
    expect(article.main_image).toMatch(/^https:\/\/cdn\.mock\//);
    // description reused as-is from the post's own SEO frontmatter field.
    expect(article.description).toBe('We rewrote the sync engine and added a real test suite.');
    expect(article.series).toBe('Behind the Scenes');
    // 5 tags in frontmatter, dev.to's 4-tag cap applied (the truncation note
    // itself, added to the log message, is covered at the unit level).
    expect(article.tags).toEqual(['astro', 'typescript', 'testing', 'devto']);
    expect(article.organization_id).toBe(4242);

    const body = article.body_markdown as string;
    // Local images rewritten...
    expect(body).not.toContain('./images/diagram.png');
    expect(body).toMatch(/https:\/\/cdn\.mock\/[a-f0-9]+\.png/);
    // ...the data-src decoy is left exactly as written (never treated as the real src)...
    expect(body).toContain('data-src="./images/lazy-placeholder.png"');
    // ...while the real src="" on that same tag was rewritten...
    expect(body).toMatch(/<img data-src="\.\/images\/lazy-placeholder\.png" src="https:\/\/cdn\.mock\//);
    // ...an already-remote image is left exactly as-is...
    expect(body).toContain('https://cdn.existing.example/existing-photo.jpg');
    // ...and both "trap" images inside code survive untouched.
    expect(body).toContain('![example](./should-not-upload.png)');
    expect(body).toContain('![inline](./also-should-not-upload.png)');
    // ...and a visible backlink footer was appended, pointing at this post's
    // own canonical URL (default behavior, `backlink` option left unset).
    expect(body).toContain(
      'originally published on [example.com](https://example.com/blog/launch-announcement/)',
    );

    // Exactly 2 unique local images referenced (diagram.png, hero.png) -> 2 uploads.
    expect(captured.cloudinary).toHaveLength(2);

    // The pre-synced MDX post: no dev.to call, file byte-for-byte unchanged
    // (proves the skip path never touches frontmatter at all).
    const mdxAfter = await readFile(MDX_POST, 'utf8');
    expect(mdxAfter).toBe(mdxBefore);

    // The draft (`syndicate: false`) must never be rewritten either.
    const draftAfter = await readFile(DRAFT_POST, 'utf8');
    expect(draftAfter).toBe(draftBefore);

    // Frontmatter of the new post now carries the sync state.
    const mdParsed = await readFrontmatter(MD_POST);
    expect(mdParsed.data.deployments.devto).toBeTypeOf('number');
    expect(mdParsed.data.deployments.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.keys(mdParsed.data.deployments.assets)).toHaveLength(2);
  });

  it('run 2: unmodified post skips entirely, editing the MDX post triggers a PUT', async () => {
    // Author edits the MDX post; nothing else changes.
    const mdxRaw = await readFile(MDX_POST, 'utf8');
    const mdxParsed = matter(mdxRaw);
    await writeFile(
      MDX_POST,
      matter.stringify(MDX_BODY_V2, mdxParsed.data),
    );

    await build({ root: SITE_ROOT, logLevel: 'silent' });

    // The already-synced, unmodified Markdown post costs zero requests this time.
    expect(captured.cloudinary).toHaveLength(0);

    // Only the edited MDX post talks to dev.to, and it's a PUT (not a new post).
    expect(captured.devto).toHaveLength(1);
    expect(captured.devto[0].method).toBe('PUT');
    expect(captured.devto[0].url).toBe('https://dev.to/api/articles/555');
    expect(captured.devto[0].article.body_markdown).toContain("'2.0.1'");

    const mdxAfter = await readFrontmatter(MDX_POST);
    expect(mdxAfter.data.deployments.devto).toBe(555); // id is preserved, not recreated
    expect(mdxAfter.data.deployments.contentHash).not.toBe(mdxParsed.data.deployments.contentHash);
  });
});

// Regression coverage for a real failure: an uploader rejecting one image
// (e.g. Cloudinary 400s an unsigned upload) used to throw all the way out of
// `astro:build:done`, aborting the whole build - every other post included,
// even ones with no images at all.
describe('a failing image upload does not take down the whole build', () => {
  const FAILURE_ROOT = join(PROJECT_ROOT, '.tmp-integration-site-failure');
  const FAILURE_BLOG_DIR = join(FAILURE_ROOT, 'src', 'content', 'blog');
  const BAD_IMAGE_POST = join(FAILURE_BLOG_DIR, 'post-with-bad-image.md');
  const CLEAN_POST = join(FAILURE_BLOG_DIR, 'post-without-images.md');

  let captured: Captured;

  beforeAll(async () => {
    await rm(FAILURE_ROOT, { recursive: true, force: true });
    await mkdir(join(FAILURE_ROOT, 'src', 'pages'), { recursive: true });
    await mkdir(FAILURE_BLOG_DIR, { recursive: true });

    await writeFile(join(FAILURE_ROOT, 'src', 'pages', 'index.astro'), '---\n---\n<html><body>ok</body></html>\n');
    await writeFile(
      join(FAILURE_ROOT, 'src', 'content.config.ts'),
      `import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

export const collections = {
  blog: defineCollection({ loader: glob({ pattern: '**/*.md', base: './src/content/blog' }) }),
};
`,
    );
    await writeFile(join(FAILURE_BLOG_DIR, 'broken.png'), Buffer.from('irrelevant-bytes'));

    // A minimal AssetUploader that always throws, standing in for a real
    // upload rejected by the host (a Cloudinary 400, a network error, ...).
    await writeFile(
      join(FAILURE_ROOT, 'throwing-uploader.ts'),
      `export class ThrowingUploader {
  name = 'throwing';
  setup() {}
  async upload() {
    throw new Error('simulated upload failure: 400 Bad Request');
  }
}
`,
    );

    const src = (...segments: string[]) =>
      JSON.stringify(pathToFileURL(join(SYNDICATION_SRC, ...segments)).href);
    await writeFile(
      join(FAILURE_ROOT, 'astro.config.mjs'),
      `import { defineConfig } from 'astro/config';
import { syndication } from ${src('index.ts')};
import { DevToProvider } from ${src('providers', 'devto.ts')};
import { ThrowingUploader } from './throwing-uploader.ts';

export default defineConfig({
  site: 'https://example.com',
  integrations: [
    syndication({
      providers: [new DevToProvider({ apiKey: 'test-key' })],
      assetUploader: new ThrowingUploader(),
      requestDelayMs: 0,
    }),
  ],
});
`,
    );

    await writeFile(
      BAD_IMAGE_POST,
      renderPost(
        { title: 'Post With Bad Image', slug: 'post-with-bad-image', syndicate: true },
        '![will fail to upload](./broken.png)\n',
      ),
    );
    await writeFile(
      CLEAN_POST,
      renderPost(
        { title: 'Post Without Images', slug: 'post-without-images', syndicate: true },
        'No local images here, nothing for the uploader to choke on.\n',
      ),
    );
  });

  afterAll(async () => {
    await rm(FAILURE_ROOT, { recursive: true, force: true });
  });

  beforeEach(() => {
    captured = installFetchMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('skips only the post whose image failed, and still syncs the rest', async () => {
    const badPostBefore = await readFile(BAD_IMAGE_POST, 'utf8');

    // The whole point: this must resolve, not reject.
    await expect(build({ root: FAILURE_ROOT, logLevel: 'silent' })).resolves.toBeUndefined();

    // The unaffected post still made it to dev.to.
    expect(captured.devto).toHaveLength(1);
    expect(captured.devto[0].article.title).toBe('Post Without Images');

    // The failed post was never sent anywhere, and its file is untouched -
    // no partial `deployments` block, nothing to clean up by hand.
    expect(await readFile(BAD_IMAGE_POST, 'utf8')).toBe(badPostBefore);
  });
});
