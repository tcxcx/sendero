/**
 * @sendero/bu — Bufi integration package.
 *
 * Centralizes everything Sendero needs to talk about / link to the
 * Bufi network: brand palette, integration metadata, and (eventually)
 * any client SDK helpers if Bufi exposes one.
 *
 * Import the brand colors:
 *   import { BUFI_PURPURA, BUFI_VIOLETA_WASH } from '@sendero/bu';
 *
 * Import integration metadata:
 *   import { BUFI_INTEGRATION, isBufiAvailable } from '@sendero/bu';
 *
 * Subpath exports keep the brand axis tree-shakable from logic that
 * doesn't need it (`@sendero/bu/brand`, `@sendero/bu/integration`).
 */

export * from './brand';
export * from './integration';
