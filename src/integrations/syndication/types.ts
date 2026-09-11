/**
 * Shared contracts for the syndication integration.
 *
 * The integration core is platform-agnostic: it discovers posts, parses
 * frontmatter, computes a content hash and then delegates the actual API work
 * to one or more providers. Supporting a new platform (Hashnode, Medium, ...)
 * means implementing `SyndicationProvider` and registering it in
 * `astro.config.mjs` — no changes to the core are required.
 */

/** Normalised view of a single blog post on disk. */
export interface BlogPost {
  /** Absolute path to the source `.md` / `.mdx` file. */
  filePath: string;
  /** Slug used to build the canonical URL (frontmatter `slug` or the file name). */
  slug: string;
  /** Post title, taken from frontmatter. */
  title: string;
  /**
   * Markdown body with the frontmatter removed. When an asset uploader is
   * configured, local image references have already been rewritten to public
   * URLs by the time a provider sees this.
   */
  content: string;
  /** Canonical URL that points back to the author's own site. */
  canonicalUrl: string;
  /** Absolute, publicly reachable cover-image URL, if the post declares one. */
  coverImageUrl?: string;
  /**
   * Tags/categories, from frontmatter `tags` (array or comma-separated
   * string). Deduplicated and trimmed; a platform's own limits (dev.to
   * allows at most 4) are that provider's concern, not the core's.
   */
  tags: string[];
  /** Series/collection name grouping related posts, from frontmatter `series`. */
  series?: string;
  /**
   * Short summary for SEO/preview, from frontmatter `description` - the same
   * field most Astro blogs already fill in for their own `<meta>` tags, so
   * there is usually nothing new to write.
   */
  description?: string;
  /** Full parsed frontmatter, in case a provider needs extra fields. */
  data: Record<string, unknown>;
}

/** A public URL for an image that has been made available to remote platforms. */
export interface UploadedAsset {
  url: string;
}

/** One image referenced by a post, resolved to a file on disk. */
export interface AssetSource {
  /** The exact reference string as written in the Markdown (used for rewrites). */
  ref: string;
  /** Absolute path to the file on disk. */
  absPath: string;
  /** SHA-256 of the file bytes. */
  hash: string;
  /** File contents. */
  bytes: Buffer;
  /** Best-effort MIME type derived from the file extension. */
  contentType: string;
}

/**
 * Makes a post's local images reachable from external platforms.
 *
 * Runs in the integration core, before any provider sees `body_markdown`.
 * The core caches every result by `AssetSource.hash` (persisted to
 * `deployments.assets`), so `upload` is only called for new or changed files.
 */
export interface AssetUploader {
  readonly name: string;
  /** Validate configuration / credentials once, before any file is processed. */
  setup(): void | Promise<void>;
  /** Upload one image and return its public URL. */
  upload(asset: AssetSource): Promise<UploadedAsset>;
}

/**
 * Persisted sync state, stored under `deployments` in each post's frontmatter.
 *
 * Example:
 *   deployments:
 *     contentHash: 9f2c1b...
 *     devto: 123456789
 *
 * `contentHash` is shared across every provider. That is intentional and safe:
 * a provider only skips work when BOTH its own id exists AND the hash is
 * unchanged, so a newly added provider still creates its remote copy on the
 * first run. If a future platform needs its own hash, widen this to
 * `devto: { id: number; contentHash: string }` — the provider contract already
 * isolates that decision.
 */
export interface Deployments {
  /** SHA-256 of (title + content + referenced image fingerprints) at last sync. */
  contentHash?: string;
  /** dev.to numeric article id. */
  devto?: number;
  /** Hashnode article id — reserved for a future provider. */
  hashnode?: string;
  /** Medium post id — reserved for a future provider. */
  medium?: string;
  /**
   * Map of `"<uploader.name>:<image SHA-256>"` -> hosted URL, maintained by
   * the asset pipeline. Namespaced by uploader so switching `assetUploader`
   * can't reuse a URL a different uploader produced.
   */
  assets?: Record<string, string>;
  /** Forward-compatible: a provider persists its remote id under its own name. */
  [providerName: string]: string | number | Record<string, string> | undefined;
}

export type SyncAction = 'created' | 'updated' | 'skipped';

/** Outcome of syncing one post to one provider. */
export interface SyncResult {
  /** Provider name, echoed back for logging. */
  provider: string;
  action: SyncAction;
  /**
   * Provider-specific id that must be written back into `deployments`.
   * Only returned when a brand new remote post was created.
   */
  remoteId?: string | number;
  /** Human-readable summary for the build log. */
  message: string;
}

/** Everything a provider needs to sync a single post. */
export interface SyncContext {
  post: BlogPost;
  /** Current sync state from frontmatter. Treat as read-only inside a provider. */
  deployments: Readonly<Deployments>;
  /** Freshly computed hash for the current file contents. */
  contentHash: string;
  /** `true` when `contentHash` differs from `deployments.contentHash`. */
  isModified: boolean;
}

/**
 * Contract every platform integration must fulfil.
 *
 * Implementations MUST:
 *  - use `ctx.isModified` to skip untouched, already-synced posts;
 *  - never publish live content while in draft mode (see `DevToProvider`);
 *  - return `remoteId` when they create a new post so the core can persist it.
 */
export interface SyndicationProvider {
  /** Stable key. MUST match the property name used inside `deployments`. */
  readonly name: string;
  /** Validate credentials / configuration once, before any post is processed. */
  setup(): void | Promise<void>;
  /** Push a single post to the platform. */
  sync(ctx: SyncContext): Promise<SyncResult>;
}
