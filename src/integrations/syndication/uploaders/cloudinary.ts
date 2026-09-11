import type { AssetSource, AssetUploader, UploadedAsset } from '../types';

export interface CloudinaryUploaderOptions {
  /** Your Cloudinary cloud name. */
  cloudName: string;
  /**
   * An *unsigned* upload preset (Cloudinary console -> Settings -> Upload).
   * Unsigned keeps this dependency-free — no API secret, no signing.
   */
  uploadPreset: string;
  /** Optional target folder. */
  folder?: string;
}

interface CloudinaryUploadResponse {
  secure_url: string;
}

/**
 * Uploads images to Cloudinary via an unsigned upload preset.
 *
 * The post's content hash is used as `public_id`, so re-uploading identical
 * bytes resolves to the same asset instead of creating duplicates.
 */
export class CloudinaryUploader implements AssetUploader {
  public readonly name = 'cloudinary';

  readonly #opts: CloudinaryUploaderOptions;

  constructor(options: CloudinaryUploaderOptions) {
    this.#opts = options;
  }

  public setup(): void {
    if (!this.#opts.cloudName || !this.#opts.uploadPreset) {
      throw new Error('[syndication/assets] CloudinaryUploader needs cloudName and uploadPreset');
    }
  }

  public async upload(asset: AssetSource): Promise<UploadedAsset> {
    // Unsigned uploads only accept a fixed parameter allowlist (public_id,
    // folder, tags, upload_preset, ...) - anything else, including
    // `overwrite`, is rejected with a 400. Configure `overwrite` (and any
    // other restricted setting) on the upload preset itself instead.
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(asset.bytes)], { type: asset.contentType }));
    form.set('upload_preset', this.#opts.uploadPreset);
    form.set('public_id', asset.hash);
    if (this.#opts.folder) {
      form.set('folder', this.#opts.folder);
    }

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${this.#opts.cloudName}/image/upload`,
      { method: 'POST', body: form },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      throw new Error(
        `[syndication/assets] Cloudinary upload failed: ${response.status} ${detail}`,
      );
    }

    const json = (await response.json()) as CloudinaryUploadResponse;
    return { url: json.secure_url };
  }
}
