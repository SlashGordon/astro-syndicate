/**
 * `canonical_url` is metadata - dev.to (and most platforms) use it for SEO,
 * not as a link they render for readers. Without something in the body
 * itself, a reader on dev.to has no visible way back to the original post.
 * This appends a short, visible footer instead.
 */

export interface BacklinkPost {
  title: string;
  canonicalUrl: string;
}

export type BacklinkFormatter = (post: BacklinkPost) => string;

/** `false` disables the footer; a function returns custom Markdown for it. */
export type BacklinkOption = false | BacklinkFormatter;

/** Default footer: an italic line linking the post's own domain to its canonical URL. */
function defaultBacklinkText(post: BacklinkPost): string {
  let host: string;
  try {
    host = new URL(post.canonicalUrl).hostname;
  } catch {
    host = post.canonicalUrl;
  }
  return `*This post was originally published on [${host}](${post.canonicalUrl}).*`;
}

/**
 * Append the backlink footer to a post body.
 * Separator formatting (blank line + `---` + blank line) is owned here, so a
 * custom formatter only needs to return the footer content itself.
 */
export function appendBacklink(
  body: string,
  post: BacklinkPost,
  option: BacklinkOption | undefined,
): string {
  if (option === false) return body;

  const footer = (option ?? defaultBacklinkText)(post).trim();
  if (!footer) return body;

  return `${body.trimEnd()}\n\n---\n\n${footer}\n`;
}
