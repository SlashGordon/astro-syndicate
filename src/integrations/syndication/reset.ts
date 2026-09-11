import { readFile, writeFile } from 'node:fs/promises';

import matter from 'gray-matter';

import { collectMarkdownFiles } from './resolve.js';

export interface ResetOptions {
  /** Report what would change without writing anything. */
  dryRun?: boolean;
}

export interface ResetResult {
  filePath: string;
  /** `true` if a `deployments` block was found (and, unless `dryRun`, removed). */
  hadDeployments: boolean;
  /**
   * The dev.to article id that was recorded, if any. There is no dev.to API
   * endpoint to delete an article - only the web dashboard does - so a
   * caller should surface this for the user to clean up by hand.
   */
  devtoId?: number;
}

/**
 * Remove the `deployments` block from one post's frontmatter, restoring it
 * to its pre-sync state. Nothing else in the file - title, tags, body, or
 * any other field - is touched.
 */
export async function clearDeployments(
  filePath: string,
  options: ResetOptions = {},
): Promise<ResetResult> {
  const raw = await readFile(filePath, 'utf8');
  const parsed = matter(raw);
  const deployments = parsed.data.deployments;

  if (!deployments || typeof deployments !== 'object') {
    return { filePath, hadDeployments: false };
  }

  const devtoId =
    typeof (deployments as Record<string, unknown>).devto === 'number'
      ? ((deployments as Record<string, unknown>).devto as number)
      : undefined;

  if (!options.dryRun) {
    const data = { ...parsed.data };
    delete data.deployments;
    await writeFile(filePath, matter.stringify(parsed.content, data), 'utf8');
  }

  return { filePath, hadDeployments: true, devtoId };
}

/** Clear `deployments` from every `.md` / `.mdx` file under `contentDir`. */
export async function resetContentDir(
  contentDir: string,
  options: ResetOptions = {},
): Promise<ResetResult[]> {
  const files = await collectMarkdownFiles(contentDir);
  const results: ResetResult[] = [];
  for (const file of files) {
    results.push(await clearDeployments(file, options));
  }
  return results;
}
