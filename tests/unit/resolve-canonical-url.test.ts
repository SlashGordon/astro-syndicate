import { describe, expect, it } from 'vitest';

import { resolveCanonicalUrl } from '../../src/integrations/syndication/resolve';

describe('resolveCanonicalUrl', () => {
  it('prefers a frontmatter canonicalUrl over everything else', () => {
    const url = resolveCanonicalUrl({
      data: { canonicalUrl: 'https://override.example/post/' },
      slug: 'my-post',
      siteUrl: 'https://example.com',
      getCanonicalUrl: () => 'https://from-option.example/',
    });

    expect(url).toBe('https://override.example/post/');
  });

  it('falls back to getCanonicalUrl when there is no frontmatter override', () => {
    const url = resolveCanonicalUrl({
      data: {},
      slug: 'my-post',
      siteUrl: 'https://example.com',
      getCanonicalUrl: ({ slug }) => `https://example.com/writing/${slug}/`,
    });

    expect(url).toBe('https://example.com/writing/my-post/');
  });

  it('falls back to `${siteUrl}/blog/${slug}/` when nothing else is set', () => {
    const url = resolveCanonicalUrl({
      data: {},
      slug: 'my-post',
      siteUrl: 'https://example.com',
    });

    expect(url).toBe('https://example.com/blog/my-post/');
  });

  it('joins siteUrl correctly whether or not it already has a trailing slash', () => {
    const withSlash = resolveCanonicalUrl({ data: {}, slug: 'p', siteUrl: 'https://example.com/' });
    const withoutSlash = resolveCanonicalUrl({ data: {}, slug: 'p', siteUrl: 'https://example.com' });

    expect(withSlash).toBe('https://example.com/blog/p/');
    expect(withoutSlash).toBe('https://example.com/blog/p/');
  });

  it('ignores an empty-string frontmatter canonicalUrl instead of returning ""', () => {
    const url = resolveCanonicalUrl({
      data: { canonicalUrl: '' },
      slug: 'my-post',
      siteUrl: 'https://example.com',
    });

    expect(url).toBe('https://example.com/blog/my-post/');
  });

  it('throws a descriptive error when no canonical URL can be built', () => {
    expect(() =>
      resolveCanonicalUrl({ data: {}, slug: 'my-post', siteUrl: undefined }),
    ).toThrow(/canonical_url/);
  });
});
