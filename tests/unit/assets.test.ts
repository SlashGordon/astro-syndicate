import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  AssetPipeline,
  findImageRefs,
  isRemoteRef,
} from '../../src/integrations/syndication/assets';
import type { AssetSource, AssetUploader, UploadedAsset } from '../../src/integrations/syndication/types';

const THIS_DIR = dirname(fileURLToPath(import.meta.url));

describe('isRemoteRef', () => {
  it.each([
    ['https://example.com/a.png', true],
    ['http://example.com/a.png', true],
    ['//cdn.example.com/a.png', true],
    ['data:image/png;base64,abc', true],
    ['./local.png', false],
    ['/local.png', false],
    ['../local.png', false],
    ['local.png', false],
  ])('%s -> %s', (ref, expected) => {
    expect(isRemoteRef(ref)).toBe(expected);
  });
});

describe('findImageRefs', () => {
  it('finds a plain Markdown image', () => {
    expect(findImageRefs('![alt](./img.png)')).toEqual(['./img.png']);
  });

  it('finds a raw <img src> tag', () => {
    expect(findImageRefs('<img src="./img.png" alt="x">')).toEqual(['./img.png']);
  });

  it('finds a URL wrapped in angle brackets (Markdown escape for spaces)', () => {
    expect(findImageRefs('![alt](<./my photo.png> "title")')).toEqual(['./my photo.png']);
  });

  it('ignores an image inside a fenced code block', () => {
    // A tutorial post showing Markdown syntax as an example must not have
    // that example text treated as a real image reference.
    const markdown = '```md\n![alt](./fenced.png)\n```';
    expect(findImageRefs(markdown)).toEqual([]);
  });

  it('ignores an image inside an inline code span', () => {
    const markdown = 'Use `![alt](./inline.png)` to add an image.';
    expect(findImageRefs(markdown)).toEqual([]);
  });

  it('still finds a real image before and after a code sample', () => {
    const markdown = [
      '![real cover](./cover.png)',
      '',
      '```md',
      '![example](./example-in-code.png)',
      '```',
      '',
      'And `inline ![x](./inline2.png) code` too.',
    ].join('\n');

    expect(findImageRefs(markdown)).toEqual(['./cover.png']);
  });

  it('picks the literal "src" attribute, never a "data-src" lazy-load attribute', () => {
    const markdown = '<img data-src="./placeholder.jpg" src="./real.gif" alt="x">';
    expect(findImageRefs(markdown)).toEqual(['./real.gif']);
  });

  it('deduplicates the same reference used twice', () => {
    const markdown = '![a](./img.png)\n\n<img src="./img.png" alt="b">';
    expect(findImageRefs(markdown)).toEqual(['./img.png']);
  });

  it('does not error on reference-style images, it just does not resolve them', () => {
    // Documented gap: ![alt][ref] + [ref]: ./path.png is not supported.
    const markdown = '![alt][ref]\n\n[ref]: ./ref-style.png';
    expect(findImageRefs(markdown)).toEqual([]);
  });

  it('does not error on alt text with nested brackets, it just does not resolve that image', () => {
    // Documented gap: the regex-based alt-text scan cannot balance brackets.
    const markdown = '![a [nested] alt](./nested.png)';
    expect(findImageRefs(markdown)).toEqual([]);
  });
});

/** In-memory stand-in for a real host: hands back a deterministic URL, no network. */
class FakeUploader implements AssetUploader {
  public calls: AssetSource[] = [];

  constructor(public readonly name = 'fake') {}

  setup(): void {}

  async upload(asset: AssetSource): Promise<UploadedAsset> {
    this.calls.push(asset);
    return { url: `https://cdn.test/${this.name}/${asset.hash.slice(0, 8)}` };
  }
}

describe('AssetPipeline', () => {
  it('leaves remote references untouched and never calls the uploader for them', async () => {
    const uploader = new FakeUploader();
    const pipeline = new AssetPipeline({
      uploader,
      postDir: '/post',
      publicDir: '/public',
      cache: {},
      requestDelayMs: 0,
      log: vi.fn(),
    });

    const url = await pipeline.resolve('https://example.com/already-hosted.png');

    expect(url).toBe('https://example.com/already-hosted.png');
    expect(uploader.calls).toHaveLength(0);
  });

  it('leaves an unresolvable local reference untouched and logs why', async () => {
    const uploader = new FakeUploader();
    const log = vi.fn();
    const pipeline = new AssetPipeline({
      uploader,
      postDir: '/does/not/exist',
      publicDir: '/public',
      cache: {},
      requestDelayMs: 0,
      log,
    });

    const url = await pipeline.resolve('./missing.png');

    expect(url).toBe('./missing.png');
    expect(uploader.calls).toHaveLength(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('rewrites duplicate references to the same URL, code blocks excluded', async () => {
    const uploader = new FakeUploader();
    // Use this test file itself as a stand-in "image" so `readFile` succeeds
    // without needing a real binary fixture on disk.
    const pipeline = new AssetPipeline({
      uploader,
      postDir: THIS_DIR,
      publicDir: '/public',
      cache: {},
      requestDelayMs: 0,
      log: vi.fn(),
    });

    const markdown = [
      '![a](./assets.test.ts)',
      '',
      '<img src="./assets.test.ts" alt="b">',
      '',
      '```md',
      '![example](./assets.test.ts)',
      '```',
    ].join('\n');

    const rewritten = await pipeline.rewriteMarkdown(markdown);

    // One unique file -> one upload, reused for every real occurrence.
    expect(uploader.calls).toHaveLength(1);
    expect(rewritten).toContain('![a](https://cdn.test/');
    expect(rewritten).toContain('<img src="https://cdn.test/');
    // The occurrence inside the fenced code block must survive untouched.
    expect(rewritten).toContain('![example](./assets.test.ts)');
  });

  it('caches by content hash: a second post referencing the same bytes does not re-upload', async () => {
    const uploader = new FakeUploader();
    const first = new AssetPipeline({
      uploader,
      postDir: THIS_DIR,
      publicDir: '/public',
      cache: {},
      requestDelayMs: 0,
      log: vi.fn(),
    });
    const firstUrl = await first.resolve('./assets.test.ts');

    // Simulate the next build: the cache from `deployments.assets` is passed in.
    const second = new AssetPipeline({
      uploader,
      postDir: THIS_DIR,
      publicDir: '/public',
      cache: first.assetMap,
      requestDelayMs: 0,
      log: vi.fn(),
    });
    const secondUrl = await second.resolve('./assets.test.ts');

    expect(secondUrl).toBe(firstUrl);
    expect(uploader.calls).toHaveLength(1); // not 2
    expect(second.dirty).toBe(false);
    expect(second.uploads).toBe(0);
  });

  it('never reuses another uploader\'s cached URL when assetUploader is switched', async () => {
    // Regression test: the cache used to be keyed by file hash alone, so
    // swapping `assetUploader` (e.g. SiteUrlUploader -> CloudinaryUploader)
    // for an unchanged file would silently keep returning the OLD
    // uploader's URL forever - the new uploader would never be called, and
    // since the resolved URL never changed, the post would never re-sync
    // either. Each uploader must get its own slice of the cache.
    const siteUrlUploader = new FakeUploader('site-url');
    const first = new AssetPipeline({
      uploader: siteUrlUploader,
      postDir: THIS_DIR,
      publicDir: '/public',
      cache: {},
      requestDelayMs: 0,
      log: vi.fn(),
    });
    const oldUrl = await first.resolve('./assets.test.ts');

    // Switch uploaders, but pass along the cache exactly as it would come
    // back from `deployments.assets` on the next build.
    const cloudinaryUploader = new FakeUploader('cloudinary');
    const second = new AssetPipeline({
      uploader: cloudinaryUploader,
      postDir: THIS_DIR,
      publicDir: '/public',
      cache: first.assetMap,
      requestDelayMs: 0,
      log: vi.fn(),
    });
    const newUrl = await second.resolve('./assets.test.ts');

    expect(cloudinaryUploader.calls).toHaveLength(1); // the new uploader WAS called
    expect(newUrl).not.toBe(oldUrl);
    expect(newUrl).toContain('cloudinary');
    expect(second.dirty).toBe(true);
    // Both entries coexist in the merged cache - switching back would be a cache hit too.
    expect(Object.keys(second.assetMap)).toHaveLength(2);
  });

  it('resolves a leading "/" reference against publicDir, not postDir', async () => {
    const uploader = new FakeUploader();
    const pipeline = new AssetPipeline({
      uploader,
      // postDir deliberately wrong/nonexistent to prove it is NOT used for "/x" refs.
      postDir: '/does/not/exist',
      publicDir: THIS_DIR,
      cache: {},
      requestDelayMs: 0,
      log: vi.fn(),
    });

    const url = await pipeline.resolve('/assets.test.ts');

    expect(url).toMatch(/^https:\/\/cdn\.test\//);
    expect(uploader.calls).toHaveLength(1);
  });
});
