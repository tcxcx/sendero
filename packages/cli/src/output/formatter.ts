/**
 * Output format resolution.
 *
 * Three modes: 'json' | 'table' | 'agent'.
 * - 'agent' is JSON output without prompts, spinners, or interactivity —
 *   the explicit signal for AI agents and CI scripts.
 * - 'json' is the same JSON output but human-driven (--json flag).
 * - 'table' is human-formatted (cli-table3 or simple text). Default when
 *   stdout is a TTY and no flag is set.
 *
 * Resolution precedence:
 *   1. --agent   → 'json' (with --quiet implied)
 *   2. --json    → 'json'
 *   3. --table   → 'table'
 *   4. prefs.defaultFormat
 *   5. isTTY()   → 'table'
 *   6. fallback  → 'json'  (piped output gets JSON)
 *
 * NO_COLOR environment variable is respected at the print layer, not
 * here — this only picks the structure (json vs table), not the chrome.
 */

import { readPrefs } from '../config/store';

export type OutputFormat = 'json' | 'table';

export interface GlobalFlags {
  json?: boolean;
  table?: boolean;
  agent?: boolean;
  quiet?: boolean;
  noInput?: boolean;
  yes?: boolean;
  dryRun?: boolean;
  apiUrl?: string;
  debug?: boolean;
}

export function isTTY(): boolean {
  return Boolean(process.stdout.isTTY);
}

export function isNoColor(): boolean {
  // NO_COLOR follows https://no-color.org — any truthy value disables color.
  return Boolean(process.env.NO_COLOR) || !isTTY();
}

export function resolveFormat(flags: GlobalFlags): OutputFormat {
  if (flags.agent || flags.json) return 'json';
  if (flags.table) return 'table';
  const prefs = readPrefs();
  if (prefs.defaultFormat) return prefs.defaultFormat;
  return isTTY() ? 'table' : 'json';
}

export function isAgentMode(flags: GlobalFlags): boolean {
  return Boolean(flags.agent);
}
