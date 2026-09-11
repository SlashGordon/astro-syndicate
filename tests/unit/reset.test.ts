import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import matter from 'gray-matter';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearDeployments, resetContentDir } from '../../src/integrations/syndication/reset';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'reset-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('clearDeployments', () => {
  it('removes the deployments block and leaves everything else untouched', async () => {
    const file = join(dir, 'post.md');
    await writeFile(
      file,
      matter.stringify('Body text.\n', {
        title: 'My Post',
        syndicate: true,
        tags: ['a', 'b'],
        deployments: { devto: 42, contentHash: 'abc123' },
      }),
    );

    const result = await clearDeployments(file);

    expect(result).toEqual({ filePath: file, hadDeployments: true, devtoId: 42 });

    const after = matter(await readFile(file, 'utf8'));
    expect(after.data).toEqual({ title: 'My Post', syndicate: true, tags: ['a', 'b'] });
    expect(after.content.trim()).toBe('Body text.');
  });

  it('is a no-op when there is no deployments block', async () => {
    const file = join(dir, 'post.md');
    const original = matter.stringify('Body.\n', { title: 'Untouched', syndicate: true });
    await writeFile(file, original);

    const result = await clearDeployments(file);

    expect(result).toEqual({ filePath: file, hadDeployments: false });
    expect(await readFile(file, 'utf8')).toBe(original);
  });

  it('reports what would change without writing anything when dryRun is true', async () => {
    const file = join(dir, 'post.md');
    const original = matter.stringify('Body.\n', {
      title: 'Dry Run',
      deployments: { devto: 7 },
    });
    await writeFile(file, original);

    const result = await clearDeployments(file, { dryRun: true });

    expect(result).toEqual({ filePath: file, hadDeployments: true, devtoId: 7 });
    expect(await readFile(file, 'utf8')).toBe(original); // unchanged
  });

  it('omits devtoId when deployments has no numeric devto field', async () => {
    const file = join(dir, 'post.md');
    await writeFile(file, matter.stringify('Body.\n', { deployments: { hashnode: 'abc' } }));

    const result = await clearDeployments(file);

    expect(result.hadDeployments).toBe(true);
    expect(result.devtoId).toBeUndefined();
  });
});

describe('resetContentDir', () => {
  it('processes every .md/.mdx file, mixed with and without deployments', async () => {
    await mkdir(join(dir, 'blog'));
    await writeFile(
      join(dir, 'blog', 'a.md'),
      matter.stringify('A.\n', { title: 'A', deployments: { devto: 1 } }),
    );
    await writeFile(
      join(dir, 'blog', 'b.mdx'),
      matter.stringify('B.\n', { title: 'B', deployments: { devto: 2 } }),
    );
    await writeFile(join(dir, 'blog', 'c.md'), matter.stringify('C.\n', { title: 'C' }));
    await writeFile(join(dir, 'blog', 'not-a-post.txt'), 'ignored, wrong extension');

    const results = await resetContentDir(join(dir, 'blog'));

    expect(results).toHaveLength(3); // the .txt file is never touched
    const withDeployments = results.filter((r) => r.hadDeployments);
    expect(withDeployments.map((r) => r.devtoId).sort()).toEqual([1, 2]);

    const aAfter = matter(await readFile(join(dir, 'blog', 'a.md'), 'utf8'));
    expect(aAfter.data.deployments).toBeUndefined();

    const txtAfter = await readFile(join(dir, 'blog', 'not-a-post.txt'), 'utf8');
    expect(txtAfter).toBe('ignored, wrong extension');
  });

  it('returns an empty array for a directory that does not exist', async () => {
    expect(await resetContentDir(join(dir, 'nope'))).toEqual([]);
  });
});
