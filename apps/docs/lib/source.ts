import { loader } from 'fumadocs-core/source';
import { docs } from '@/.source';

/**
 * Central source loader used by the docs shell + the `[[...slug]]`
 * catch-all route. Adding a new MDX file under `content/docs` makes
 * it render automatically; `meta.json` controls the sidebar order.
 */
export const source = loader({
  baseUrl: '/docs',
  source: docs.toFumadocsSource(),
});
