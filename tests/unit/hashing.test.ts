import { describe, expect, it } from 'vitest';

import { generateContentHash } from '../../src/integrations/syndication/hashing';

describe('generateContentHash', () => {
  it('is deterministic for the same title and content', () => {
    const a = generateContentHash('Hello World', 'Some body text.');
    const b = generateContentHash('Hello World', 'Some body text.');
    expect(a).toBe(b);
  });

  it('changes when the title changes', () => {
    const a = generateContentHash('Title A', 'Same body.');
    const b = generateContentHash('Title B', 'Same body.');
    expect(a).not.toBe(b);
  });

  it('changes when the content changes', () => {
    const a = generateContentHash('Same Title', 'Body A.');
    const b = generateContentHash('Same Title', 'Body B.');
    expect(a).not.toBe(b);
  });

  it('ignores leading/trailing whitespace so re-saving a file does not force a re-sync', () => {
    const a = generateContentHash('Title', 'Body text.');
    const b = generateContentHash('  Title  ', '\n\nBody text.\n\n');
    expect(a).toBe(b);
  });

  it('produces a 64-character lowercase hex digest (SHA-256)', () => {
    const hash = generateContentHash('Title', 'Body');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is order-independent for asset fingerprints (sorted before hashing)', () => {
    const a = generateContentHash('Title', 'Body', ['hash-b', 'hash-a']);
    const b = generateContentHash('Title', 'Body', ['hash-a', 'hash-b']);
    expect(a).toBe(b);
  });

  it('changes when the set of asset fingerprints changes', () => {
    // This is the guarantee that makes "swap an image file at the same path"
    // detectable even when the rewritten Markdown URL stays identical.
    const withOldImage = generateContentHash('Title', 'Body', ['image-hash-v1']);
    const withNewImage = generateContentHash('Title', 'Body', ['image-hash-v2']);
    const withNoImage = generateContentHash('Title', 'Body', []);

    expect(withOldImage).not.toBe(withNewImage);
    expect(withOldImage).not.toBe(withNoImage);
  });
});
