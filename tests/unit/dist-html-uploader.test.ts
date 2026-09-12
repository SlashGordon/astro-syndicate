import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  describe('a realistic page with many images that do not belong to the post', () => {
    // A full layout: nav logo, a hero banner, a decorative background image
    // on <body>'s own inline style (not an <img> at all), a sidebar full of
    // "related posts" thumbnails, and a footer full of social icons - all
    // outside <article> - surrounding three real content images inside it,
    // one of them alt-less to also exercise positional matching in a
    // realistically noisy document instead of a two-image toy page.
    async function writeFullPage(slug: string): Promise<void> {
      const dir = join(distDir, slug);
      await mkdir(dir, { recursive: true });
      const distractors = Array.from(
        { length: 6 },
        (_, i) => `<img src="/related/${i}.jpg" alt="Related post ${i}">`,
      ).join('');
      const socialIcons = ['twitter', 'github', 'mastodon', 'rss']
        .map((name) => `<img src="/icons/${name}.svg" alt="${name}">`)
        .join('');
      const html = `<html><body>
        <nav><img src="/logo.svg" alt="Site logo"></nav>
        <div class="hero" style="background-image:url(/hero.jpg)"></div>
        <aside class="sidebar"><h2>Related</h2>${distractors}</aside>
        <article>
          <h1>A real post</h1>
          <p>Some text.</p>
          <img src="/assets/first.hash1.webp" alt="First real photo">
          <p>More text in between.</p>
          <img src="/assets/second.hash2.webp" alt="">
          <p>Even more text.</p>
          <img src="/assets/third.hash3.webp" alt="Third real photo">
        </article>
        <footer>${socialIcons}</footer>
      </body></html>`;
      await writeFile(join(dir, 'index.html'), html);
    }

    it('picks only the real content images, ignoring every distractor outside <article>', async () => {
      await writeFullPage('noisy-post');
      const uploader = new DistHtmlUploader({ distDir, siteUrl: 'https://example.com' });
      uploader.setup();

      const first = await uploader.upload(asset({ slug: 'noisy-post', ref: './first.jpg', alt: 'First real photo' }));
      const third = await uploader.upload(asset({ slug: 'noisy-post', ref: './third.jpg', alt: 'Third real photo' }));
      // No alt on this one - positional fallback must land on the one
      // remaining unclaimed *article* image, not any of the ten distractors
      // that sit earlier in the raw HTML (nav, hero-adjacent, sidebar).
      const second = await uploader.upload(asset({ slug: 'noisy-post', ref: './second.jpg', alt: '' }));

      expect(first.url).toBe('https://example.com/assets/first.hash1.webp');
      expect(third.url).toBe('https://example.com/assets/third.hash3.webp');
      expect(second.url).toBe('https://example.com/assets/second.hash2.webp');
    });

    it('reports a plausibility mismatch when the Markdown image count does not match the rendered count', async () => {
      await writeFullPage('noisy-post');
      const log = vi.fn();
      const uploader = new DistHtmlUploader({ distDir, siteUrl: 'https://example.com', log });
      uploader.setup();

      // The post's Markdown claims 5 local images; the article only rendered 3.
      await uploader.upload(asset({ slug: 'noisy-post', ref: './first.jpg', alt: 'First real photo', totalLocalImages: 5 }));

      expect(log).toHaveBeenCalledWith(expect.stringContaining('plausibility check failed'));
      expect(log).toHaveBeenCalledWith(expect.stringContaining('references 5 local image(s)'));
      expect(log).toHaveBeenCalledWith(expect.stringContaining('3 <img> tag(s) were found'));
    });

    it('does not warn when the Markdown image count matches the rendered count', async () => {
      await writeFullPage('noisy-post');
      const log = vi.fn();
      const uploader = new DistHtmlUploader({ distDir, siteUrl: 'https://example.com', log });
      uploader.setup();

      await uploader.upload(asset({ slug: 'noisy-post', ref: './first.jpg', alt: 'First real photo', totalLocalImages: 3 }));

      expect(log).not.toHaveBeenCalledWith(expect.stringContaining('plausibility check failed'));
    });

    it('only checks plausibility once per post, even across several images', async () => {
      await writeFullPage('noisy-post');
      const log = vi.fn();
      const uploader = new DistHtmlUploader({ distDir, siteUrl: 'https://example.com', log });
      uploader.setup();

      await uploader.upload(asset({ slug: 'noisy-post', ref: './first.jpg', alt: 'First real photo', totalLocalImages: 5 }));
      await uploader.upload(asset({ slug: 'noisy-post', ref: './third.jpg', alt: 'Third real photo', totalLocalImages: 5 }));

      const mismatchWarnings = log.mock.calls.filter(([msg]) => String(msg).includes('plausibility check failed'));
      expect(mismatchWarnings).toHaveLength(1);
    });

    it('logs an alt-text match distinctly from a positional fallback match', async () => {
      await writeFullPage('noisy-post');
      const log = vi.fn();
      const uploader = new DistHtmlUploader({ distDir, siteUrl: 'https://example.com', log });
      uploader.setup();

      await uploader.upload(asset({ slug: 'noisy-post', ref: './first.jpg', alt: 'First real photo' }));
      await uploader.upload(asset({ slug: 'noisy-post', ref: './second.jpg', alt: '' }));

      expect(log).toHaveBeenCalledWith(expect.stringContaining('matched by alt text "First real photo"'));
      expect(log).toHaveBeenCalledWith(expect.stringContaining('fell back to position'));
    });
  });
});
