import { describe, expect, it, vi } from 'vitest';

import { resolveMdxImages } from '../../src/integrations/syndication/mdx-jsx';

const noop = () => {
  /* no-op logger */
};

describe('resolveMdxImages', () => {
  it('is a no-op on a post with no imports and no JSX', async () => {
    const content = '# Title\n\nJust prose, no images at all.\n';
    expect(await resolveMdxImages(content, { postDir: '/post', log: noop })).toBe(content);
  });

  it('strips import lines even when nothing else in the post needs resolving', async () => {
    const content = [
      "import Badge from 'some-package/Badge.astro';",
      '',
      'Prose that uses <Badge>experimental</Badge> inline.',
    ].join('\n');

    const out = await resolveMdxImages(content, { postDir: '/post', log: noop });
    expect(out).not.toContain('import Badge');
    expect(out).toContain('<Badge>experimental</Badge>');
  });

  it('resolves an astro:assets <Image> tag to a plain Markdown image', async () => {
    const content = [
      "import { Image } from 'astro:assets';",
      "import money from '../../src/assets/images/money.jpg';",
      '',
      '<Image src={money} alt="Money" width={200} format="webp" class="float-left" />',
    ].join('\n');

    const out = await resolveMdxImages(content, { postDir: '/post', log: noop });
    expect(out).not.toContain('import ');
    expect(out).not.toContain('<Image');
    expect(out).toContain('![Money](../../src/assets/images/money.jpg)');
  });

  it('leaves an <Image> tag as-is and logs when its src does not resolve', async () => {
    const content = '<Image src={unknownVar} alt="x" />';
    const log = vi.fn();

    const out = await resolveMdxImages(content, { postDir: '/post', log });
    expect(out).toContain('<Image src={unknownVar}');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('unresolvable src'));
  });

  it('expands an images={[{ src, alt }]} prop into one Markdown image per entry', async () => {
    const content = [
      "import ImageGallery from 'astro-gallery/components/ImageGallery.astro';",
      "import grafana1 from '../../src/assets/images/homelab/grafana_dashboards_1.png';",
      "import grafana2 from '../../src/assets/images/homelab/grafana_dashboards_2.png';",
      '',
      '<ImageGallery images={[',
      '{ src: grafana1, alt: "Grafana Dashboard Overview" },',
      '{ src: grafana2, alt: "Grafana Dashboard Metrics" },',
      ']} columns={2} />',
    ].join('\n');

    const out = await resolveMdxImages(content, { postDir: '/post', log: noop });
    expect(out).not.toContain('<ImageGallery');
    expect(out).toContain('![Grafana Dashboard Overview](../../src/assets/images/homelab/grafana_dashboards_1.png)');
    expect(out).toContain('![Grafana Dashboard Metrics](../../src/assets/images/homelab/grafana_dashboards_2.png)');
  });

  it('supports a bare identifier array for the images prop', async () => {
    const content = [
      "import ImageGallery from 'astro-gallery/components/ImageGallery.astro';",
      "import a from '../../src/assets/images/a.jpg';",
      "import b from '../../src/assets/images/b.jpg';",
      '',
      '<ImageGallery images={[a, b]} />',
    ].join('\n');

    const out = await resolveMdxImages(content, { postDir: '/post', log: noop });
    expect(out).toContain('![](../../src/assets/images/a.jpg)');
    expect(out).toContain('![](../../src/assets/images/b.jpg)');
  });

  it('removes a folder-driven component and warns when no resolveFolderImages hook is configured', async () => {
    const content = [
      "import MapGallery from 'astro-gallery/components/MapGallery.astro';",
      '',
      '<MapGallery folderPath="images/carlo/abenteuer" />',
    ].join('\n');
    const log = vi.fn();

    const out = await resolveMdxImages(content, { postDir: '/post', log });
    expect(out).not.toContain('<MapGallery');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('no resolveFolderImages hook'));
  });

  it('resolves a folder-driven component via resolveFolderImages', async () => {
    const content = [
      "import ImageTimeline from 'astro-gallery/components/ImageTimeline.astro';",
      '',
      '<ImageTimeline folderPath="images/carlo/bestof" />',
    ].join('\n');

    const out = await resolveMdxImages(content, {
      postDir: '/project/src/pages/en',
      resolveFolderImages: (folderPath) => {
        expect(folderPath).toBe('images/carlo/bestof');
        return [
          { path: '/project/src/assets/images/carlo/bestof/1.jpg', alt: 'First' },
          { path: '/project/src/assets/images/carlo/bestof/2.jpg' },
        ];
      },
      log: noop,
    });

    expect(out).not.toContain('<ImageTimeline');
    expect(out).toContain('![First](../../assets/images/carlo/bestof/1.jpg)');
    expect(out).toContain('![](../../assets/images/carlo/bestof/2.jpg)');
  });

  it('never touches an Image tag or import shown inside a fenced code block', async () => {
    const content = [
      "import money from '../../src/assets/images/money.jpg';",
      '',
      '```mdx',
      "import money from '../../src/assets/images/money.jpg';",
      '<Image src={money} alt="Money" />',
      '```',
      '',
      '<Image src={money} alt="Money" />',
    ].join('\n');

    const out = await resolveMdxImages(content, { postDir: '/post', log: noop });
    // The real usage below the fence is resolved...
    expect(out).toContain('![Money](../../src/assets/images/money.jpg)');
    // ...but the example inside the fence survives untouched.
    expect(out).toContain('```mdx');
    expect(out).toContain("import money from '../../src/assets/images/money.jpg';\n<Image src={money} alt=\"Money\" />");
  });
});
