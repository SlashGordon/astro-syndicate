import type { BlogPost, SyncContext, SyncResult, SyndicationProvider } from '../types';

/** dev.to REST base. See https://developers.forem.com/api/v1 */
const API_ROOT = 'https://dev.to/api';

/** dev.to accepts at most 4 tags per article (API docs, `createArticle`). */
const MAX_TAGS = 4;

export interface DevToProviderOptions {
  /**
   * Personal API key from https://dev.to/settings/extensions.
   * Falls back to `process.env.DEVTO_API_KEY` when omitted.
   */
  apiKey?: string;
  /** Publish under this Forem organization. Omit to post as yourself. */
  organizationId?: number;
}

/** Fields shared by both `POST /articles` and `PUT /articles/{id}`. */
interface DevToArticleFields {
  title: string;
  body_markdown: string;
  canonical_url: string;
  /** Cover image. Must be an absolute, publicly reachable URL. */
  main_image?: string;
  /** SEO/preview summary. */
  description?: string;
  /** Groups articles together; created automatically if it doesn't exist yet. */
  series?: string;
  /**
   * At most `MAX_TAGS` entries - see `formatDevToTags`.
   *
   * Sent as an array, NOT a comma-joined string. The API docs' own schema
   * table says `tags: string` (comma-separated) - that is wrong in practice:
   * Forem's own request specs
   * (github.com/forem/forem/blob/main/spec/requests/api/v0/articles_spec.rb)
   * exercise `tags` as an array, and a comma string reliably results in
   * zero tags landing on the created/updated article, with no error.
   */
  tags?: string[];
  organization_id?: number;
}

/**
 * Fit a post's tags into dev.to's max-4-per-article limit.
 * Exported standalone since the truncation behavior is worth testing on its
 * own, separate from any network call.
 */
export function formatDevToTags(tags: readonly string[]): { value?: string[]; truncated: boolean } {
  if (tags.length === 0) return { truncated: false };
  const kept = tags.slice(0, MAX_TAGS);
  return { value: kept, truncated: tags.length > MAX_TAGS };
}

/**
 * CRITICAL: `published` is set to `false` on creation ONLY.
 *
 * Per the dev.to API docs, sending `published: false` on an UPDATE to an
 * already-published article silently reverts it to draft - so once you (a
 * human) publish a syndicated draft yourself, this integration must never
 * touch that field again, or the next content edit would unpublish it.
 * https://developers.forem.com/api/v1#tag/articles/operation/updateArticle
 */
interface DevToCreateBody {
  article: DevToArticleFields & { published: false };
}
interface DevToUpdateBody {
  article: DevToArticleFields;
}

/** Subset of the article payload dev.to returns on create/update. */
interface DevToArticle {
  id: number;
  url: string;
}

/**
 * Syncs a post to dev.to.
 *
 * Decision table (see `sync`):
 *  - no `deployments.devto`               -> POST   /articles          (create)
 *  - `deployments.devto` + hash changed   -> PUT    /articles/{id}     (update)
 *  - `deployments.devto` + hash unchanged -> no request                (skip)
 */
export class DevToProvider implements SyndicationProvider {
  public readonly name = 'devto';

  readonly #apiKey: string;
  readonly #organizationId: number | undefined;

  constructor(options: DevToProviderOptions = {}) {
    this.#apiKey = options.apiKey ?? process.env.DEVTO_API_KEY ?? '';
    this.#organizationId = options.organizationId;
  }

  /** Runs once, before any file is processed. Fail fast on missing credentials. */
  public setup(): void {
    if (!this.#apiKey) {
      throw new Error(
        '[syndication/devto] No API key. Pass `apiKey` to the provider or set DEVTO_API_KEY.',
      );
    }
  }

  public async sync(ctx: SyncContext): Promise<SyncResult> {
    const remoteId = ctx.deployments.devto;

    // --- Change detection ------------------------------------------------
    // For an already-synced article we only touch the network when the
    // content hash actually moved. Unmodified posts cost zero requests.
    if (typeof remoteId === 'number' && !ctx.isModified) {
      return {
        provider: this.name,
        action: 'skipped',
        message: `unmodified - dev.to #${remoteId} left untouched`,
      };
    }

    const { fields, note } = this.#buildFields(ctx.post);

    // --- Create --------------------------------------------------------
    if (typeof remoteId !== 'number') {
      const body: DevToCreateBody = { article: { ...fields, published: false } };
      const created = await this.#send('POST', '/articles', body);
      return {
        provider: this.name,
        action: 'created',
        remoteId: created.id,
        message: `created dev.to #${created.id} (${created.url})${note}`,
      };
    }

    // --- Update ------------------------------------------------------
    // Reached only when the article exists AND the hash changed. `published`
    // is deliberately omitted - see the CRITICAL note on DevToCreateBody.
    const body: DevToUpdateBody = { article: fields };
    const updated = await this.#send('PUT', `/articles/${remoteId}`, body);
    return {
      provider: this.name,
      action: 'updated',
      message: `updated dev.to #${updated.id} (${updated.url})${note}`,
    };
  }

  /** Build the fields shared by create and update, plus a log-friendly note about any truncation. */
  #buildFields(post: BlogPost): { fields: DevToArticleFields; note: string } {
    const tags = formatDevToTags(post.tags);

    const fields: DevToArticleFields = {
      title: post.title,
      body_markdown: post.content,
      canonical_url: post.canonicalUrl,
      ...(post.coverImageUrl ? { main_image: post.coverImageUrl } : {}),
      ...(post.description ? { description: post.description } : {}),
      ...(post.series ? { series: post.series } : {}),
      ...(tags.value ? { tags: tags.value } : {}),
      ...(this.#organizationId ? { organization_id: this.#organizationId } : {}),
    };

    const note = tags.truncated ? ` (tags truncated to ${MAX_TAGS})` : '';
    return { fields, note };
  }

  /** Thin `fetch` wrapper with dev.to auth headers and error surfacing. */
  async #send(
    method: 'POST' | 'PUT',
    path: string,
    body: DevToCreateBody | DevToUpdateBody,
  ): Promise<DevToArticle> {
    const response = await fetch(`${API_ROOT}${path}`, {
      method,
      headers: {
        'api-key': this.#apiKey,
        'content-type': 'application/json',
        accept: 'application/vnd.forem.api-v1+json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      throw new Error(
        `[syndication/devto] ${method} ${path} -> ${response.status} ${response.statusText}: ${detail}`,
      );
    }

    return (await response.json()) as DevToArticle;
  }
}
