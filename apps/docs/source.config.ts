import { defineDocs, defineConfig } from 'fumadocs-mdx/config';

/**
 * Fumadocs v14 MDX source. We keep it simple: one `docs` collection
 * rooted at `content/docs`. Per-tool pages live under `content/docs/tools/*`
 * and are referenced from `meta.json`.
 */
export const docs = defineDocs({
  dir: 'content/docs',
});

export default defineConfig({
  mdxOptions: {
    // Shiki themes chosen to match the cream / vermilion palette.
    // `min-light` reads warm on the cream background; `github-dark`
    // is muted enough not to fight the ink when the user flips dark.
    rehypeCodeOptions: {
      themes: {
        light: 'min-light',
        dark: 'github-dark',
      },
    },
  },
});
