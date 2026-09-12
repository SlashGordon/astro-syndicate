import { afterEach, describe, expect, it, vi } from 'vitest';

import { CloudinaryUploader } from '../../src/integrations/syndication/uploaders/cloudinary';
import { SiteUrlUploader } from '../../src/integrations/syndication/uploaders/site-url';
import type { AssetSource } from '../../src/integrations/syndication/types';

function makeAsset(overrides: Partial<AssetSource> = {}): AssetSource {
  return {
    ref: './img.png',
    absPath: '/project/public/images/img.png',
    hash: 'abc123',
    bytes: Buffer.from('fake-image-bytes'),
    contentType: 'image/png',
    slug: 'test-post',
    ...overrides,
  };
}

describe('SiteUrlUploader', () => {
  it('maps a file under publicDir to an absolute site URL', async () => {
    const uploader = new SiteUrlUploader({
      siteUrl: 'https://example.com',
      publicDir: '/project/public',
    });

    const { url } = await uploader.upload(
      makeAsset({ absPath: '/project/public/images/img.png' }),
    );

    expect(url).toBe('https://example.com/images/img.png');
  });

  it('works the same whether siteUrl has a trailing slash or not', async () => {
    const withSlash = new SiteUrlUploader({ siteUrl: 'https://example.com/', publicDir: '/pub' });
    const withoutSlash = new SiteUrlUploader({ siteUrl: 'https://example.com', publicDir: '/pub' });

    const asset = makeAsset({ absPath: '/pub/a.png' });
    expect((await withSlash.upload(asset)).url).toBe('https://example.com/a.png');
    expect((await withoutSlash.upload(asset)).url).toBe('https://example.com/a.png');
  });

  it('rejects a file outside publicDir instead of producing a wrong URL', async () => {
    const uploader = new SiteUrlUploader({ siteUrl: 'https://example.com', publicDir: '/project/public' });

    await expect(
      uploader.upload(makeAsset({ absPath: '/project/src/content/blog/images/img.png' })),
    ).rejects.toThrow(/outside publicDir/);
  });

  it('setup() rejects a non-absolute siteUrl', () => {
    const uploader = new SiteUrlUploader({ siteUrl: 'example.com', publicDir: '/pub' });
    expect(() => uploader.setup()).toThrow(/absolute siteUrl/);
  });
});

describe('CloudinaryUploader', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('setup() requires both cloudName and uploadPreset', () => {
    expect(() => new CloudinaryUploader({ cloudName: '', uploadPreset: 'x' }).setup()).toThrow();
    expect(() => new CloudinaryUploader({ cloudName: 'x', uploadPreset: '' }).setup()).toThrow();
    expect(() => new CloudinaryUploader({ cloudName: 'x', uploadPreset: 'y' }).setup()).not.toThrow();
  });

  it('posts to the cloud-specific endpoint with the expected form fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ secure_url: 'https://res.cloudinary.com/demo/image/upload/abc123.png' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const uploader = new CloudinaryUploader({
      cloudName: 'demo',
      uploadPreset: 'unsigned-preset',
      folder: 'blog',
    });

    const { url } = await uploader.upload(makeAsset({ hash: 'deadbeef' }));

    expect(url).toBe('https://res.cloudinary.com/demo/image/upload/abc123.png');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [requestUrl, init] = fetchMock.mock.calls[0];
    expect(requestUrl).toBe('https://api.cloudinary.com/v1_1/demo/image/upload');

    const form = init.body as FormData;
    expect(form.get('upload_preset')).toBe('unsigned-preset');
    expect(form.get('public_id')).toBe('deadbeef'); // content hash -> dedupe key
    expect(form.get('folder')).toBe('blog');
  });

  it('never sends `overwrite` - Cloudinary rejects it outright on unsigned uploads', async () => {
    // Regression test: unsigned uploads only accept a fixed parameter
    // allowlist; `overwrite` isn't in it and Cloudinary 400s the whole
    // request if it's present, even set to a value matching the preset.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ secure_url: 'https://res.cloudinary.com/demo/image/upload/x.png' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const uploader = new CloudinaryUploader({ cloudName: 'demo', uploadPreset: 'preset' });
    await uploader.upload(makeAsset());

    const [, init] = fetchMock.mock.calls[0];
    const form = init.body as FormData;
    expect(form.has('overwrite')).toBe(false);
  });

  it('throws a descriptive error on a failed upload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => 'invalid upload preset',
    });
    vi.stubGlobal('fetch', fetchMock);

    const uploader = new CloudinaryUploader({ cloudName: 'demo', uploadPreset: 'bad' });

    await expect(uploader.upload(makeAsset())).rejects.toThrow(/400/);
  });
});
