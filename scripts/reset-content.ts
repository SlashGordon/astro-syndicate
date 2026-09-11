/**
 * Undo tool: clears the `deployments` block from every post under a content
 * directory, restoring pristine, pre-sync frontmatter.
 *
 * There is no dev.to API endpoint to delete an article - only the web
 * dashboard does - so this can't remove anything from dev.to itself. What it
 * can do is tell you exactly which draft ids to delete there.
 *
 * Usage:
 *   tsx scripts/reset-content.ts <content-dir> [--dry-run]
 */
import { resolve } from 'node:path';

import { resetContentDir } from '../src/integrations/syndication/reset';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const dir = args.find((arg) => !arg.startsWith('--'));

  if (!dir) {
    console.error('Usage: tsx scripts/reset-content.ts <content-dir> [--dry-run]');
    process.exitCode = 1;
    return;
  }

  const contentDir = resolve(process.cwd(), dir);
  const results = await resetContentDir(contentDir, { dryRun });
  const touched = results.filter((result) => result.hadDeployments);

  if (touched.length === 0) {
    console.log(`Nothing to reset under ${dir} - no file has a deployments block.`);
    return;
  }

  console.log(`${dryRun ? '[dry run] would reset' : 'Reset'} ${touched.length} file(s):`);
  for (const result of touched) {
    const note = result.devtoId !== undefined ? ` (was dev.to #${result.devtoId})` : '';
    console.log(`  - ${result.filePath}${note}`);
  }

  const devtoIds = touched
    .map((result) => result.devtoId)
    .filter((id): id is number => id !== undefined);

  if (devtoIds.length > 0) {
    console.log(
      `\ndev.to has no API to delete an article - only the web dashboard does.\n` +
        `Delete these ${devtoIds.length} draft(s) by hand: https://dev.to/dashboard`,
    );
  }
}

main();
