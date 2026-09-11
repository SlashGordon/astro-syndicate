import { describe, expect, it } from 'vitest';

import { appendBacklink } from '../../src/integrations/syndication/backlink';

const post = { title: 'My Post', canonicalUrl: 'https://www.slashgordon.link/blog/my-post/' };

describe('appendBacklink', () => {
  it('appends a footer linking the post domain to its canonical URL by default', () => {
    const result = appendBacklink('Body text.', post, undefined);

    expect(result).toBe(
      'Body text.\n\n---\n\n*This post was originally published on ' +
        '[www.slashgordon.link](https://www.slashgordon.link/blog/my-post/).*\n',
    );
  });

  it('does nothing when disabled with `false`', () => {
    expect(appendBacklink('Body text.', post, false)).toBe('Body text.');
  });

  it('uses a custom formatter when provided', () => {
    const result = appendBacklink('Body text.', post, () => 'Custom footer.');
    expect(result).toBe('Body text.\n\n---\n\nCustom footer.\n');
  });

  it('trims trailing whitespace from the body before appending', () => {
    const result = appendBacklink('Body text.\n\n\n', post, false);
    expect(result).toBe('Body text.\n\n\n'); // false short-circuits, body untouched
  });

  it('normalizes body/footer whitespace when a footer is appended', () => {
    const result = appendBacklink('Body text.   \n\n', post, () => '  padded footer  ');
    expect(result).toBe('Body text.\n\n---\n\npadded footer\n');
  });

  it('falls back to the raw canonicalUrl as link text when it is not a valid URL', () => {
    const result = appendBacklink('Body.', { title: 'x', canonicalUrl: 'not-a-url' }, undefined);
    expect(result).toContain('[not-a-url](not-a-url)');
  });

  it('skips the footer entirely if a custom formatter returns blank text', () => {
    expect(appendBacklink('Body text.', post, () => '   ')).toBe('Body text.');
  });
});
