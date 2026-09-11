import { createHash } from 'node:crypto';

/**
 * Build a stable SHA-256 fingerprint of a post.
 *
 * Only the title and the Markdown body feed the hash. Frontmatter is
 * deliberately excluded so that bookkeeping writes (adding the remote id,
 * updating `contentHash` itself) are never mistaken for a content change.
 * Inputs are trimmed so trailing-whitespace churn does not trigger a re-sync.
 */
export function generateContentHash(
  title: string,
  content: string,
  assetHashes: readonly string[] = [],
): string {
  const hash = createHash('sha256')
    .update(title.trim(), 'utf8')
    .update('\n\n', 'utf8')
    .update(content.trim(), 'utf8');

  // Fold in the fingerprints of every referenced image so that replacing an
  // image file (same path, new bytes) still registers as a content change,
  // even when its rewritten URL happens to stay the same.
  for (const assetHash of [...assetHashes].sort()) {
    hash.update('\n', 'utf8').update(assetHash, 'utf8');
  }

  return hash.digest('hex');
}
