import type { Appearance } from '@clerk/types';

/**
 * Sendero brand theme for every Clerk component.
 *
 * Mirrors the `--clerk-*` CSS variables we set in each app's
 * globals.css so the runtime theme matches the design tokens. Both
 * paths exist because Clerk v7 picks colors from `appearance.variables`
 * but reads radius/spacing from the CSS vars — keep them in lockstep.
 *
 * Source-of-truth values (light surface):
 *   primary       #fb542b  vermillion
 *   background    #fcf1e6  parchment
 *   foreground    #3b3636  ink
 *   neutral       #000000
 *   input         #ffffff
 *   ring          #000000
 *   danger        #ef4444
 *   success       #22c543
 *   warning       #f36b16
 *   borderRadius  0.375rem (md)
 *   spacing       1rem     (md)
 */
export const senderoClerkAppearance: Appearance = {
  variables: {
    colorPrimary: '#fb542b',
    colorPrimaryForeground: '#ffffff',
    colorDanger: '#ef4444',
    colorSuccess: '#22c543',
    colorWarning: '#f36b16',
    colorNeutral: '#000000',
    colorForeground: '#3b3636',
    colorBackground: '#fcf1e6',
    colorInput: '#ffffff',
    colorInputForeground: '#000000',
    colorRing: '#000000',
    colorShimmer: '#ffffff',
    colorModalBackdrop: '#000000',
    colorMuted: '#ffffff',
    colorMutedForeground: '#fb542b',
    borderRadius: '0.375rem',
    spacing: '1rem',
  },
};
