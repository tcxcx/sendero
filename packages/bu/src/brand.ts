/**
 * Bufi brand palette. Source of truth: desk-v1 invoice templates
 * (`packages/invoice/src/templates/report/components/metrics-grid.tsx::
 * BUFI_GRAPH_COLORS`). Mirrored here verbatim so Sendero surfaces don't
 * drift from the partner brand book.
 */

/** Primary deep purple — drives borders, primary labels. */
export const BUFI_PURPURA = '#6854CF';

/** Secondary purple — used in gradients + highlight strokes. */
export const BUFI_VIOLETA = '#C4A1FF';

/** Soft violeta wash — card backgrounds at rest. */
export const BUFI_VIOLETA_WASH = '#F0E9FF';

/** Brand green accent. */
export const BUFI_VVERDE = '#82E664';

/** Pink accent. */
export const BUFI_BELANOVA = '#FEADEC';

/** Warm yellow accent. */
export const BUFI_AGNUS_DEI = '#FFECB4';

/** Lavender purple (graph color). */
export const BUFI_MORADO = '#AB8DFF';

/** Red/pink accent. */
export const BUFI_ROJO = '#FF507A';

/** Mint accent. */
export const BUFI_MINT_DANIS = '#B7FFF1';

/**
 * Full ordered palette as the desk-v1 metrics-grid uses it. Useful for
 * charts that need a deterministic per-series color cycle.
 */
export const BUFI_GRAPH_COLORS: readonly string[] = [
  BUFI_PURPURA,
  BUFI_VIOLETA,
  BUFI_VVERDE,
  BUFI_BELANOVA,
  BUFI_AGNUS_DEI,
  BUFI_MORADO,
  BUFI_ROJO,
  BUFI_MINT_DANIS,
];
