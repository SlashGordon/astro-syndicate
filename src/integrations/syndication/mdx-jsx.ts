import { extname, relative, sep } from 'node:path';

import { IMAGE_EXTENSIONS, codeRanges, isMasked } from './assets.js';

/**
 * MDX-specific pre-processing, run before the regular Markdown/HTML image
 * pipeline (`assets.ts`) ever sees a post's body.
 *
 * `.mdx` lets a post pull images in through JavaScript rather than a plain
 * `![alt](src)` string: `astro:assets`' own `<Image src={imported} />`, and
 * any similarly-shaped folder or image-array gallery component. None of that
 * is a file path a remote platform could ever resolve, and left as-is it
 * ships as literal `import ...` lines and empty custom tags in the post body
 * sent to a provider.
 *
 * This module turns the patterns above back into plain `![alt](src)`
 * Markdown - using each image's own import path as the `src`, unresolved -
 * so the existing image pipeline picks them up exactly like it would in a
 * `.md` post with no build step at all. It does not touch anything else, and
 * a shape it does not recognise is best-effort: logged and left alone (an
 * `<Image>` tag) or stripped with a warning (a folder-driven component with
 * no `resolveFolderImages` hook configured), never guessed at.
 */

/** One image a folder-driven component would have rendered. */
export interface FolderImage {
  /** Absolute path to the file on disk. */
  path: string;
  alt?: string;
}

export interface ResolveMdxImagesOptions {
  /** Directory containing the post file - import paths and folder-hook results are resolved relative to it. */
  postDir: string;
  /**
   * Resolves a capitalised component's `folderPath="..."` prop (astro-gallery's
   * `MapGallery`/`ImageTimeline`/etc., or anything following the same
   * convention) to the images it would render at build time. That list only
   * exists inside whatever integration owns the convention, so this package
   * cannot know it on its own - without this hook, a `folderPath` component
   * is stripped from the body and a warning is logged instead of guessing.
   */
  resolveFolderImages?: (
    folderPath: string,
    ctx: { postDir: string },
  ) => FolderImage[] | Promise<FolderImage[]>;
  log: (message: string) => void;
}

// A capitalised JSX tag name - the convention that separates a component
// (`<ImageGallery>`) from a plain HTML element (`<img>`, `<div>`) - is the
// only signal this module uses to decide a tag is a gallery component. It
// never hard-codes astro-gallery's (or any other package's) component names.
const TAG_NAME = '[A-Z]\\w*';

const IMPORT_LINE = /^import\b[^\n]*\n/gm;
const DEFAULT_IMPORT = /^import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/;

const IMAGE_TAG = new RegExp(`<Image\\b([^>]*?)\\/>`, 'gs');
const IMAGES_PROP_TAG = new RegExp(`<(${TAG_NAME})\\b([^>]*?\\bimages=\\{\\[[\\s\\S]*?\\]\\}[^>]*?)\\/>`, 'g');
const FOLDER_PATH_TAG = new RegExp(`<(${TAG_NAME})\\b([^>]*?\\bfolderPath=["'][^"']*["'][^>]*?)\\/>`, 'g');

const OBJECT_ITEM = /\{\s*src:\s*(\w+)\s*(?:,\s*alt:\s*["']([^"']*)["'])?\s*,?\s*\}/g;

function toMarkdownRef(absPath: string, postDir: string): string {
  return relative(postDir, absPath).split(sep).join('/');
}

function markdownImage(alt: string | undefined, src: string): string {
  return `![${alt ?? ''}](${src})`;
}

/** Remove every top-level `import` line, outside of code fences. Returns the map of `identifier -> import path` for image imports. */
function stripImports(content: string): { content: string; imageImports: Map<string, string> } {
  const ranges = codeRanges(content);
  const imageImports = new Map<string, string>();
  const cuts: Array<[number, number]> = [];

  for (const match of content.matchAll(IMPORT_LINE)) {
    if (isMasked(match.index, ranges)) continue;
    cuts.push([match.index, match.index + match[0].length]);

    const named = DEFAULT_IMPORT.exec(match[0]);
    if (named && IMAGE_EXTENSIONS.has(extname(named[2]).toLowerCase())) {
      imageImports.set(named[1], named[2]);
    }
  }

  if (cuts.length === 0) return { content, imageImports };

  let out = '';
  let cursor = 0;
  for (const [start, end] of cuts) {
    out += content.slice(cursor, start);
    cursor = end;
  }
  out += content.slice(cursor);
  return { content: out, imageImports };
}

/** `<Image src={identifier} alt="..." ... />` -> `![alt](importPath)`. */
function resolveImageTags(content: string, imageImports: Map<string, string>, log: (message: string) => void): string {
  const ranges = codeRanges(content);
  return content.replace(IMAGE_TAG, (full, attrs: string, offset: number) => {
    if (isMasked(offset, ranges)) return full;

    const src = /\bsrc=\{(\w+)\}/.exec(attrs)?.[1];
    const alt = /\balt=["']([^"']*)["']/.exec(attrs)?.[1];
    const path = src ? imageImports.get(src) : undefined;

    if (!path) {
      log(`<Image> with an unresolvable src, left as-is: ${full.slice(0, 60)}...`);
      return full;
    }
    return markdownImage(alt, path);
  });
}

/** Parse an `images={[ ... ]}` array into ordered `{ src, alt }` identifier entries. */
function parseImagesProp(arrayText: string): Array<{ src: string; alt?: string }> {
  const objectItems = [...arrayText.matchAll(OBJECT_ITEM)].map((m) => ({ src: m[1]!, alt: m[2] }));
  if (objectItems.length > 0) return objectItems;

  // Fall back to a bare identifier array: `images={[a, b, c]}`.
  return arrayText
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => /^\w+$/.test(entry))
    .map((src) => ({ src }));
}

/** `<AnyComponent images={[{ src, alt }, ...]} .../>` -> one `![alt](importPath)` line per entry. */
function resolveImagesPropTags(content: string, imageImports: Map<string, string>, log: (message: string) => void): string {
  const ranges = codeRanges(content);
  return content.replace(IMAGES_PROP_TAG, (full, _tag: string, attrs: string, offset: number) => {
    if (isMasked(offset, ranges)) return full;

    const arrayMatch = /\bimages=\{\[([\s\S]*?)\]\}/.exec(attrs);
    const entries = arrayMatch ? parseImagesProp(arrayMatch[1]!) : [];

    const lines = entries
      .map(({ src, alt }) => {
        const path = imageImports.get(src);
        if (!path) {
          log(`images prop entry "${src}" has no matching import, skipped`);
          return undefined;
        }
        return markdownImage(alt, path);
      })
      .filter((line): line is string => line !== undefined);

    if (lines.length === 0) {
      log(`component with an images prop resolved to no images, removed: ${full.slice(0, 60)}...`);
      return '';
    }
    return lines.join('\n\n');
  });
}

/** `<AnyComponent folderPath="..." .../>` -> the hook's images, or removed with a warning when no hook is configured. */
async function resolveFolderPathTags(
  content: string,
  options: ResolveMdxImagesOptions,
): Promise<string> {
  const matches = [...content.matchAll(FOLDER_PATH_TAG)];
  if (matches.length === 0) return content;

  const ranges = codeRanges(content);
  let out = content;
  for (const match of matches) {
    if (isMasked(match.index, ranges)) continue;

    const full = match[0];
    const attrs = match[2]!;
    const folderPath = /\bfolderPath=["']([^"']*)["']/.exec(attrs)?.[1];

    let replacement = '';
    if (folderPath && options.resolveFolderImages) {
      const images = await options.resolveFolderImages(folderPath, { postDir: options.postDir });
      replacement = images
        .map(({ path, alt }) => markdownImage(alt, toMarkdownRef(path, options.postDir)))
        .join('\n\n');
      if (!replacement) {
        options.log(`folderPath "${folderPath}" resolved to no images, removed: ${full.slice(0, 60)}...`);
      }
    } else if (folderPath) {
      options.log(
        `folderPath "${folderPath}" removed: no resolveFolderImages hook configured, so its images can't be resolved`,
      );
    }
    out = out.replace(full, replacement);
  }
  return out;
}

/**
 * Run the full MDX pre-processing pass: strip `import` lines, then resolve
 * `<Image>`, `images={[...]}` and `folderPath="..."` back to plain Markdown
 * images. A no-op on a post that uses none of these (including every plain
 * `.md` file, which cannot contain JSX at all).
 */
export async function resolveMdxImages(content: string, options: ResolveMdxImagesOptions): Promise<string> {
  const { content: stripped, imageImports } = stripImports(content);

  // No early-return shortcut here on purpose: IMAGE_TAG / IMAGES_PROP_TAG /
  // FOLDER_PATH_TAG are shared, global-flagged regexes reused across every
  // file in a run. `.test()` on a global regex leaves `lastIndex` at wherever
  // it last matched, which would corrupt the *next* file's scan; `.replace()`
  // resets it up front, so calling straight through is what's actually safe.
  let out = resolveImageTags(stripped, imageImports, options.log);
  out = resolveImagesPropTags(out, imageImports, options.log);
  out = await resolveFolderPathTags(out, options);
  return out;
}
