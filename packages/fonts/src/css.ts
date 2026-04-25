/**
 * Drop-in CSS string that aliases the four canonical font variables to the
 * design-system names every app's globals.css already references:
 *
 *   --sans / --mono / --display / --mono-x
 *
 * Usage:
 *
 *   import { senderoFontStyles } from '@sendero/fonts/css';
 *   // inside <head>:
 *   <style dangerouslySetInnerHTML={{ __html: senderoFontStyles }} />
 *
 * Only used by apps that don't already centralise this in their own
 * globals.css. The recommended pattern is to inline the equivalent
 * declarations into globals.css directly so postcss/tailwind can see them.
 */

export const senderoFontStyles = `
:root {
  --sans: var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: var(--font-geist-mono), ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  --display: var(--font-display), var(--sans);
  --mono-x: var(--font-mono-x), var(--mono);
}
`;
