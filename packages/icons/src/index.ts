/**
 * @sendero/icons — single source of truth for brand marks used across
 * Sendero's Next.js apps.
 *
 * Two flavours:
 *  - Inline SVG components (MCP). Render in current text color.
 *  - Static raster imports (Google/Anthropic/OpenAI provider webps,
 *    Bufi logo png). Wrapped in next/image; resolved via webpack at
 *    build time so they ship through Next's static asset pipeline,
 *    not via /public.
 *
 * Subpath exports (`@sendero/icons/providers`, `@sendero/icons/integrations`)
 * mirror the asset axis so consumers tree-shake to only what they need.
 */

export { ProviderIcon, PROVIDER_ICON_SOURCES, PROVIDER_LABEL } from './providers';
export type { ProviderSlug } from './providers';
export { McpMark, BufiLogo, BufiLogoSrc } from './integrations';
