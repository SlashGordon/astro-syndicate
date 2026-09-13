import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import matter from 'gray-matter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runSyndication } from '../../src/integrations/syndication/run';
import type { SyncContext, SyncResult, SyndicationProvider } from '../../src/integrations/syndication/types';

/** Records every call instead of touching the network - proves standalone use needs no Astro at all. */
class FakeProvider implements SyndicationProvider {
  public setupCalls = 0;
  public syncCalls: SyncContext[] = [];

  constructor(public readonly name: string = 'fake') {}

  async setup(): Promise<void> {
    this.setupCalls += 1;
  }

  async sync(ctx: SyncContext): Promise<SyncResult> {
    this.syncCalls.push(ctx);
    // Mirrors DevToProvider's own decision table so tests can exercise a
    // real skip-when-unmodified path, not just "always creates".
    if (typeof ctx.deployments[this.name] === 'number' && !ctx.isModified) {
      return { provider: this.name, action: 'skipped', message: 'unmodified' };
    }
    return { provider: this.name, action: 'created', remoteId: 1, message: 'created' };
  }
}

function fakeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'run-test-'));
  await mkdir(join(dir, 'blog'), { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('runSyndication (standalone, no Astro involved)', () => {
  it('syncs a post to a plain call - this is the "run after deploy" usage', async () => {
    await writeFile(
      join(dir, 'blog', 'post.md'),
      matter.stringify('Body.\n', { title: 'Post', syndicate: true }),
    );

    const provider = new FakeProvider();
    const logger = fakeLogger();
    const result = await runSyndication({
      providers: [provider],
      projectRoot: dir,
      contentDir: 'blog',
      siteUrl: 'https://example.com',
      requestDelayMs: 0,
      logger,
    });

    expect(provider.setupCalls).toBe(1);
    expect(provider.syncCalls).toHaveLength(1);
    expect(result.totalCalls).toBe(1);

    const written = matter(await readFile(join(dir, 'blog', 'post.md'), 'utf8'));
    expect(written.data.deployments.fake).toBe(1);
  });

  it('only syncs a post to the providers named true in its `syndicate` frontmatter', async () => {
    await writeFile(
      join(dir, 'blog', 'devto-only.md'),
      matter.stringify('Body.\n', { title: 'Devto Only', syndicate: { devto: true, medium: false } }),
    );
    await writeFile(
      join(dir, 'blog', 'medium-only.md'),
      matter.stringify('Body.\n', { title: 'Medium Only', syndicate: { medium: true } }),
    );
    await writeFile(
      join(dir, 'blog', 'neither.md'),
      matter.stringify('Body.\n', { title: 'Neither', syndicate: { devto: false, medium: false } }),
    );
    await writeFile(
      join(dir, 'blog', 'not-flagged.md'),
      matter.stringify('Body.\n', { title: 'Not Flagged' }),
    );

    const devto = new FakeProvider('devto');
    const medium = new FakeProvider('medium');

    await runSyndication({
      providers: [devto, medium],
      projectRoot: dir,
      contentDir: 'blog',
      siteUrl: 'https://example.com',
      requestDelayMs: 0,
      logger: fakeLogger(),
    });

    expect(devto.syncCalls.map((ctx) => ctx.post.title)).toEqual(['Devto Only']);
    expect(medium.syncCalls.map((ctx) => ctx.post.title)).toEqual(['Medium Only']);
  });

  it('still opts into every configured provider for the legacy `syndicate: true` form', async () => {
    await writeFile(
      join(dir, 'blog', 'post.md'),
      matter.stringify('Body.\n', { title: 'Post', syndicate: true }),
    );

    const devto = new FakeProvider('devto');
    const medium = new FakeProvider('medium');

    await runSyndication({
      providers: [devto, medium],
      projectRoot: dir,
      contentDir: 'blog',
      siteUrl: 'https://example.com',
      requestDelayMs: 0,
      logger: fakeLogger(),
    });

    expect(devto.syncCalls).toHaveLength(1);
    expect(medium.syncCalls).toHaveLength(1);
  });

  it('processes posts oldest-first by the date field, regardless of file name order', async () => {
    // File names sort the opposite of the intended date order, on purpose.
    await writeFile(
      join(dir, 'blog', 'a-newest.md'),
      matter.stringify('Body.\n', { title: 'Newest', syndicate: true, date: '2026-03-01' }),
    );
    await writeFile(
      join(dir, 'blog', 'b-oldest.md'),
      matter.stringify('Body.\n', { title: 'Oldest', syndicate: true, date: '2026-01-01' }),
    );
    await writeFile(
      join(dir, 'blog', 'c-middle.md'),
      matter.stringify('Body.\n', { title: 'Middle', syndicate: true, date: '2026-02-01' }),
    );

    const provider = new FakeProvider();
    await runSyndication({
      providers: [provider],
      projectRoot: dir,
      contentDir: 'blog',
      siteUrl: 'https://example.com',
      requestDelayMs: 0,
      logger: fakeLogger(),
    });

    expect(provider.syncCalls.map((ctx) => ctx.post.title)).toEqual(['Oldest', 'Middle', 'Newest']);
  });

  it('sorts a post with no usable date after every dated post, then by file path', async () => {
    await writeFile(
      join(dir, 'blog', 'a-no-date.md'),
      matter.stringify('Body.\n', { title: 'No Date', syndicate: true }),
    );
    await writeFile(
      join(dir, 'blog', 'z-dated.md'),
      matter.stringify('Body.\n', { title: 'Dated', syndicate: true, date: '2026-06-01' }),
    );

    const provider = new FakeProvider();
    await runSyndication({
      providers: [provider],
      projectRoot: dir,
      contentDir: 'blog',
      siteUrl: 'https://example.com',
      requestDelayMs: 0,
      logger: fakeLogger(),
    });

    // "z-dated.md" sorts after "a-no-date.md" by file name, but its date
    // still puts it first - only a post with no date at all falls back to
    // file-path order.
    expect(provider.syncCalls.map((ctx) => ctx.post.title)).toEqual(['Dated', 'No Date']);
  });

  it('maxSyncsPerRun caps real syncs per provider, leaving the rest untouched for a later run', async () => {
    for (const [name, date] of [['first', '2026-01-01'], ['second', '2026-01-02'], ['third', '2026-01-03']] as const) {
      await writeFile(
        join(dir, 'blog', `${name}.md`),
        matter.stringify('Body.\n', { title: name, syndicate: true, date }),
      );
    }

    const provider = new FakeProvider();
    const result = await runSyndication({
      providers: [provider],
      projectRoot: dir,
      contentDir: 'blog',
      siteUrl: 'https://example.com',
      requestDelayMs: 0,
      maxSyncsPerRun: 1,
      logger: fakeLogger(),
    });

    expect(provider.syncCalls.map((ctx) => ctx.post.title)).toEqual(['first']);
    expect(result.totalCalls).toBe(1);

    // "second" and "third" were never touched, not skipped-and-marked-done -
    // no `deployments` block means they're still first in line next run.
    const second = matter(await readFile(join(dir, 'blog', 'second.md'), 'utf8'));
    const third = matter(await readFile(join(dir, 'blog', 'third.md'), 'utf8'));
    expect(second.data.deployments).toBeUndefined();
    expect(third.data.deployments).toBeUndefined();
  });

  it('maxSyncsPerRun applies independently per provider when given as a map', async () => {
    await writeFile(
      join(dir, 'blog', 'first.md'),
      matter.stringify('Body.\n', { title: 'First', syndicate: true, date: '2026-01-01' }),
    );
    await writeFile(
      join(dir, 'blog', 'second.md'),
      matter.stringify('Body.\n', { title: 'Second', syndicate: true, date: '2026-01-02' }),
    );

    const devto = new FakeProvider('devto');
    const medium = new FakeProvider('medium');

    await runSyndication({
      providers: [devto, medium],
      projectRoot: dir,
      contentDir: 'blog',
      siteUrl: 'https://example.com',
      requestDelayMs: 0,
      maxSyncsPerRun: { devto: 1 },
      logger: fakeLogger(),
    });

    expect(devto.syncCalls).toHaveLength(1);
    expect(medium.syncCalls).toHaveLength(2);
  });

  it('an unmodified (skipped) post does not count against the cap', async () => {
    await writeFile(
      join(dir, 'blog', 'first.md'),
      matter.stringify('Body.\n', { title: 'First', syndicate: true, date: '2026-01-01' }),
    );

    // First run: syncs and persists real deployment state for "first".
    await runSyndication({
      providers: [new FakeProvider()],
      projectRoot: dir,
      contentDir: 'blog',
      siteUrl: 'https://example.com',
      requestDelayMs: 0,
      logger: fakeLogger(),
    });

    // Second post added afterwards, dated later.
    await writeFile(
      join(dir, 'blog', 'second.md'),
      matter.stringify('Body.\n', { title: 'Second', syndicate: true, date: '2026-01-02' }),
    );

    const provider = new FakeProvider();
    const result = await runSyndication({
      providers: [provider],
      projectRoot: dir,
      contentDir: 'blog',
      siteUrl: 'https://example.com',
      requestDelayMs: 0,
      maxSyncsPerRun: 1,
      logger: fakeLogger(),
    });

    // Both are attempted in date order ("first" is processed first, and
    // correctly comes back "skipped" since it's unmodified) - but only a
    // genuine create/update counts against the cap, so a cap of 1 still
    // lets "second" (truly new) go out in the same run.
    expect(provider.syncCalls.map((ctx) => ctx.post.title)).toEqual(['First', 'Second']);
    expect(result.totalCalls).toBe(1);

    const second = matter(await readFile(join(dir, 'blog', 'second.md'), 'utf8'));
    expect(second.data.deployments.fake).toBe(1);
  });

  it('defaults to `console` when no logger is given', async () => {
    // Just needs to not throw when providers is empty - console.warn gets called.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await runSyndication({ providers: [], projectRoot: dir });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no providers configured'));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('enabled: false short-circuits before touching providers or the filesystem', async () => {
    await writeFile(
      join(dir, 'blog', 'post.md'),
      matter.stringify('Untouched body.\n', { title: 'Untouched Post', syndicate: true }),
    );

    const provider = new FakeProvider();
    const logger = fakeLogger();

    const result = await runSyndication({
      providers: [provider],
      projectRoot: dir,
      contentDir: 'blog',
      enabled: false,
      logger,
    });

    expect(result.totalCalls).toBe(0);
    expect(provider.setupCalls).toBe(0);
    expect(provider.syncCalls).toHaveLength(0);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('disabled'));

    // This is exactly the pattern for an environment check, e.g.
    // `enabled: process.env.NODE_ENV === 'production'` - prove the file
    // really was left untouched, not just that providers were skipped.
    const untouched = matter(await readFile(join(dir, 'blog', 'post.md'), 'utf8'));
    expect(untouched.data.deployments).toBeUndefined();
  });

  it('warns and does nothing when no providers are configured', async () => {
    const logger = fakeLogger();
    const result = await runSyndication({ providers: [], projectRoot: dir, logger });

    expect(result.totalCalls).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('no providers configured'));
  });

  it('never corrupts gray-matter\'s parse cache for other files with identical starting content', async () => {
    // Regression test for a real bug: gray-matter caches parse results
    // globally, keyed by the exact raw input string, whenever `matter()` is
    // called without an `options` argument. Mutating the returned `data`
    // object in place corrupts that shared cache entry, so ANY other file
    // that starts out byte-identical - two posts sharing boilerplate
    // frontmatter, or the same fixture reused in two tests - would appear to
    // already have deployments it never actually had.
    const dirB = await mkdtemp(join(tmpdir(), 'run-test-'));
    await mkdir(join(dirB, 'blog'), { recursive: true });
    try {
      const sameStartingContent = matter.stringify('Shared body.\n', {
        title: 'Shared Title',
        syndicate: true,
      });
      await writeFile(join(dir, 'blog', 'post.md'), sameStartingContent);
      await writeFile(join(dirB, 'blog', 'post.md'), sameStartingContent);

      // Process the file in `dir` - this is what used to poison the cache.
      await runSyndication({
        providers: [new FakeProvider()],
        projectRoot: dir,
        contentDir: 'blog',
        siteUrl: 'https://example.com',
        requestDelayMs: 0,
        logger: fakeLogger(),
      });

      // `dirB`'s file was never touched by any run - parsing it fresh must
      // reflect that, not whatever the identically-started file in `dir` now has.
      const untouched = matter(await readFile(join(dirB, 'blog', 'post.md'), 'utf8'));
      expect(untouched.data.deployments).toBeUndefined();
    } finally {
      await rm(dirB, { recursive: true, force: true });
    }
  });
});
