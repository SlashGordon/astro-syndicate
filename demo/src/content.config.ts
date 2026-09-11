import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

// Only `.md` is globbed here - `.mdx` needs `@astrojs/mdx` to render as a
// page, which this demo doesn't install. That's fine: the syndication
// integration reads every `.md`/`.mdx` file directly off disk and never
// goes through this collection, so the MDX post still gets synced.
export const collections = {
  blog: defineCollection({ loader: glob({ pattern: '**/*.md', base: './src/content/blog' }) }),
};
