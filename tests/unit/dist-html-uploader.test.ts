import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DistHtmlUploader } from '../../src/integrations/syndication/uploaders/dist-html';
import type { AssetSource } from '../../src/integrations/syndication/types';

let distDir: string;

function asset(overrides: Partial<AssetSource> = {}): AssetSource {
  return {
    ref: './img.png',
    absPath: '/project/src/assets/img.png',
    hash: 'abc123',
    bytes: Buffer.from('fake'),
    contentType: 'image/png',
    slug: 'my-post',
    ...overrides,
  };
}

async function writePage(slug: string, articleHtml: string): Promise<void> {
  const dir = join(distDir, slug);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'index.html'),
    `<html><body><header><img src="/logo.png" alt="Site logo"></header><article>${articleHtml}</article></body></html>`,
  );
}

beforeEach(async () => {
  distDir = await mkdtemp(join(tmpdir(), 'dist-html-test-'));
});

afterEach(async () => {
  await rm(distDir, { recursive: true, force: true });
});

describe('DistHtmlUploader', () => {
  it('matches an image by exact alt text', async () => {
    await writePage(
      'my-post',
      '<img src="/assets/a.hash1.webp" alt="First"><img src="/assets/b.hash2.webp" alt="Second">',
    );
    const uploader = new DistHtmlUploader({ distDir, siteUrl: 'https://example.com' });
    uploader.setup();

    const result = await uploader.upload(asset({ alt: 'Second' }));
    expect(result.url).toBe('https://example.com/assets/b.hash2.webp');
  });

  it('never matches the header logo outside <article>', async () => {
    // The only "Site logo" alt in the whole page is on the header logo,
    // outside <article> - scoping to <article> makes it invisible, so this
    // falls through to positional matching against the one image that IS
    // inside <article>, regardless of its own (different) alt text.
    await writePage('my-post', '<img src="/assets/a.hash1.webp" alt="First Photo">');
    const uploader = new DistHtmlUploader({ distDir, siteUrl: 'https://example.com' });
    uploader.setup();

    const result = await uploader.upload(asset({ alt: 'Site logo' }));
    expect(result.url).toBe('https://example.com/assets/a.hash1.webp');
  });

  it('falls back to document order when alt does not match anything', async () => {
    await writePage('my-post', '<img src="/assets/a.hash1.webp" alt=""><img src="/assets/b.hash2.webp" alt="">');
    const uploader = new DistHtmlUploader({ distDir, siteUrl: 'https://example.com' });
    uploader.setup();

    const first = await uploader.upload(asset({ ref: './a.png' }));
    const second = await uploader.upload(asset({ ref: './b.png' }));
    expect(first.url).toBe('https://example.com/assets/a.hash1.webp');
    expect(second.url).toBe('https://example.com/assets/b.hash2.webp');
  });

  it('does not re-match an image already claimed by another ref in the same post', async () => {
    await writePage('my-post', '<img src="/assets/only.hash.webp" alt="">');
    const uploader = new DistHtmlUploader({ distDir, siteUrl: 'https://example.com' });
    uploader.setup();

    await uploader.upload(asset({ ref: './a.png' }));
    await expect(uploader.upload(asset({ ref: './b.png' }))).rejects.toThrow(/could not match/);
  });

  it('supports a custom pagePath mapping', async () => {
    await mkdir(join(distDir, 'post', 'my-post'), { recursive: true });
    await writeFile(
      join(distDir, 'post', 'my-post', 'index.html'),
      '<article><img src="/assets/a.hash1.webp" alt="First"></article>',
    );
    const uploader = new DistHtmlUploader({
      distDir,
      siteUrl: 'https://example.com',
      pagePath: (slug) => `post/${slug}`,
    });
    uploader.setup();

    const result = await uploader.upload(asset({ alt: 'First' }));
    expect(result.url).toBe('https://example.com/assets/a.hash1.webp');
  });

  it('throws a clear error when the post has no built page at all', async () => {
    const uploader = new DistHtmlUploader({ distDir, siteUrl: 'https://example.com' });
    uploader.setup();

    await expect(uploader.upload(asset({ slug: 'missing-post' }))).rejects.toThrow(/no built page found/);
  });

  it('setup() rejects a non-absolute siteUrl', () => {
    const uploader = new DistHtmlUploader({ distDir, siteUrl: '/not-absolute' });
    expect(() => uploader.setup()).toThrow(/absolute siteUrl/);
  });
});
