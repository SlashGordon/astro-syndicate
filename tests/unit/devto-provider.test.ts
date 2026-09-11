import { afterEach, describe, expect, it, vi } from 'vitest';

import { DevToProvider, formatDevToTags } from '../../src/integrations/syndication/providers/devto';
import type { BlogPost, Deployments, SyncContext } from '../../src/integrations/syndication/types';

function makePost(overrides: Partial<BlogPost> = {}): BlogPost {
  return {
    filePath: '/blog/post.md',
    slug: 'post',
    title: 'Test Post',
    content: 'Body content.',
    canonicalUrl: 'https://example.com/blog/post/',
    tags: [],
    data: {},
    ...overrides,
  };
}

interface CtxOverrides {
  post?: Partial<BlogPost>;
  deployments?: Deployments;
  contentHash?: string;
  isModified?: boolean;
}

function makeCtx(overrides: CtxOverrides = {}): SyncContext {
  const deployments: Deployments = overrides.deployments ?? {};
  const contentHash = overrides.contentHash ?? 'hash-1';
  return {
    post: makePost(overrides.post),
    deployments,
    contentHash,
    isModified: overrides.isModified ?? contentHash !== deployments.contentHash,
  };
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('DevToProvider.setup', () => {
  afterEach(() => {
    delete process.env.DEVTO_API_KEY;
  });

  it('throws when no API key is available', () => {
    const provider = new DevToProvider({});
    expect(() => provider.setup()).toThrow(/API key/);
  });

  it('accepts an explicit apiKey', () => {
    const provider = new DevToProvider({ apiKey: 'explicit' });
    expect(() => provider.setup()).not.toThrow();
  });

  it('falls back to the DEVTO_API_KEY environment variable', () => {
    process.env.DEVTO_API_KEY = 'from-env';
    const provider = new DevToProvider({});
    expect(() => provider.setup()).not.toThrow();
  });
});

describe('formatDevToTags', () => {
  it('passes tags through as an array (not a comma-joined string)', () => {
    // Sending a comma-joined string instead of an array is exactly the bug
    // that made every tag silently vanish on the real API - see the CRITICAL
    // note on DevToArticleFields.tags.
    expect(formatDevToTags(['astro', 'typescript'])).toEqual({
      value: ['astro', 'typescript'],
      truncated: false,
    });
  });

  it('returns no value for an empty list', () => {
    expect(formatDevToTags([])).toEqual({ truncated: false });
  });

  it('caps at 4 tags and reports truncation', () => {
    const result = formatDevToTags(['a', 'b', 'c', 'd', 'e']);
    expect(result).toEqual({ value: ['a', 'b', 'c', 'd'], truncated: true });
  });
});

describe('DevToProvider.sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a new article with POST when no remote id exists yet', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 42, url: 'https://dev.to/x/42' }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new DevToProvider({ apiKey: 'key' });
    const result = await provider.sync(makeCtx({ deployments: {} }));

    expect(result).toEqual({
      provider: 'devto',
      action: 'created',
      remoteId: 42,
      message: expect.stringContaining('created dev.to #42'),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://dev.to/api/articles');
    expect(init.method).toBe('POST');
    expect(init.headers['api-key']).toBe('key');

    const body = JSON.parse(init.body);
    expect(body.article).toMatchObject({
      title: 'Test Post',
      body_markdown: 'Body content.',
      canonical_url: 'https://example.com/blog/post/',
      published: false,
    });
    expect(body.article).not.toHaveProperty('main_image');
  });

  it('includes main_image when the post has a cover image URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 1, url: 'https://dev.to/x/1' }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new DevToProvider({ apiKey: 'key' });
    await provider.sync(
      makeCtx({ post: { coverImageUrl: 'https://cdn.example.com/cover.png' }, deployments: {} }),
    );

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.article.main_image).toBe('https://cdn.example.com/cover.png');
  });

  it('includes tags (as an array), series, description and organization_id when present', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 1, url: 'https://dev.to/x/1' }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new DevToProvider({ apiKey: 'key', organizationId: 99 });
    await provider.sync(
      makeCtx({
        post: {
          tags: ['astro', 'typescript'],
          series: 'Building a Blog',
          description: 'A short SEO summary.',
        },
        deployments: {},
      }),
    );

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.article.tags).toEqual(['astro', 'typescript']);
    expect(body.article.series).toBe('Building a Blog');
    expect(body.article.description).toBe('A short SEO summary.');
    expect(body.article.organization_id).toBe(99);
  });

  it('omits tags/series/description/organization_id entirely when not set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 1, url: 'https://dev.to/x/1' }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new DevToProvider({ apiKey: 'key' }); // no organizationId
    await provider.sync(makeCtx({ deployments: {} })); // makePost() defaults: tags: []

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.article).not.toHaveProperty('tags');
    expect(body.article).not.toHaveProperty('series');
    expect(body.article).not.toHaveProperty('description');
    expect(body.article).not.toHaveProperty('organization_id');
  });

  it('notes truncation in the result message when a post has more than 4 tags', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 1, url: 'https://dev.to/x/1' }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new DevToProvider({ apiKey: 'key' });
    const result = await provider.sync(
      makeCtx({ post: { tags: ['a', 'b', 'c', 'd', 'e'] }, deployments: {} }),
    );

    expect(result.message).toContain('truncated to 4');
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).article.tags).toEqual(['a', 'b', 'c', 'd']);
  });

  it('updates with PUT when a remote id exists and the content changed', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 42, url: 'https://dev.to/x/42' }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new DevToProvider({ apiKey: 'key' });
    const result = await provider.sync(
      makeCtx({
        deployments: { devto: 42, contentHash: 'old-hash' },
        contentHash: 'new-hash',
      }),
    );

    expect(result.action).toBe('updated');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://dev.to/api/articles/42');
    expect(init.method).toBe('PUT');
  });

  it('never sends `published` on an update, so a manually-published post is never reverted to draft', async () => {
    // Per the dev.to API docs, `published: false` on an UPDATE silently
    // reverts an already-live article to draft. Regression test for that.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 42, url: 'https://dev.to/x/42' }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new DevToProvider({ apiKey: 'key' });
    await provider.sync(
      makeCtx({ deployments: { devto: 42, contentHash: 'old-hash' }, contentHash: 'new-hash' }),
    );

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.article).not.toHaveProperty('published');
  });

  it('skips the network entirely when a remote id exists and the hash is unchanged', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const provider = new DevToProvider({ apiKey: 'key' });
    const result = await provider.sync(
      makeCtx({
        deployments: { devto: 42, contentHash: 'same-hash' },
        contentHash: 'same-hash',
      }),
    );

    expect(result.action).toBe('skipped');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a descriptive error when dev.to responds with a non-2xx status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'nope' }, false, 422));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new DevToProvider({ apiKey: 'key' });
    await expect(provider.sync(makeCtx({ deployments: {} }))).rejects.toThrow(/422/);
  });
});
