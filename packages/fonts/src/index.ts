/**
 * @sendero/fonts — canonical font system.
 *
 *   --sans     Geist            (UI + body, npm: geist)
 *   --mono     Geist Mono       (default mono, npm: geist)
 *   --display  Fraunces         (editorial display serif, OFL, self-hosted)
 *   --mono-x   IoskeleyMono     (Berkeley Mono alternative, OFL, self-hosted)
 *
 * Apply `senderoFontVars` as a className on <html>. Then in CSS:
 *   font-family: var(--font-geist-sans);   // body
 *   font-family: var(--font-display);      // headlines
 *   font-family: var(--font-geist-mono);   // default mono
 *   font-family: var(--font-mono-x);       // display mono / character
 *
 * Or use the friendlier aliases that ./css.ts mounts for you.
 */

import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import localFont from 'next/font/local';

export const senderoSans = GeistSans;
export const senderoMono = GeistMono;

export const senderoDisplay = localFont({
  src: [
    {
      path: '../assets/Fraunces/Fraunces-Variable.ttf',
      style: 'normal',
      weight: '100 900',
    },
    {
      path: '../assets/Fraunces/Fraunces-Italic-Variable.ttf',
      style: 'italic',
      weight: '100 900',
    },
  ],
  variable: '--font-display',
  display: 'swap',
  preload: false,
  fallback: ['ui-serif', 'Georgia', 'serif'],
});

export const senderoMonoX = localFont({
  src: [
    {
      path: '../assets/IoskeleyMono/IoskeleyMono-Regular.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../assets/IoskeleyMono/IoskeleyMono-Italic.woff2',
      weight: '400',
      style: 'italic',
    },
    {
      path: '../assets/IoskeleyMono/IoskeleyMono-Medium.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: '../assets/IoskeleyMono/IoskeleyMono-Bold.woff2',
      weight: '700',
      style: 'normal',
    },
  ],
  variable: '--font-mono-x',
  display: 'swap',
  preload: false,
  fallback: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
});

/**
 * Space-separated `.variable` className list. Apply to <html> in every app's
 * root layout so the four CSS custom properties are available everywhere.
 */
export const senderoFontVars = [
  senderoSans.variable,
  senderoMono.variable,
  senderoDisplay.variable,
  senderoMonoX.variable,
].join(' ');
