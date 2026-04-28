/**
 * Print helpers — JSON / table / colored text.
 *
 * Color discipline: every color call routes through `c.*` helpers below
 * which short-circuit when NO_COLOR is set or stdout isn't a TTY. Never
 * call picocolors directly from command code.
 */

import pc from 'picocolors';
import { isNoColor } from './formatter';

function maybeColor(fn: (s: string) => string): (s: string) => string {
  return (s: string) => (isNoColor() ? s : fn(s));
}

export const c = {
  bold: maybeColor(pc.bold),
  dim: maybeColor(pc.dim),
  green: maybeColor(pc.green),
  red: maybeColor(pc.red),
  yellow: maybeColor(pc.yellow),
  cyan: maybeColor(pc.cyan),
  // Sendero brand-adjacent — vermillion-ish via 256-color when supported.
  vermillion: maybeColor((s: string) => `[38;5;167m${s}[0m`),
};

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function printText(text: string): void {
  process.stdout.write(`${text}\n`);
}

export function printError(error: { problem: string; cause?: string; fix?: string; docs?: string }): void {
  // Standard error shape per DX review: problem + cause + fix + docs link.
  process.stderr.write(`${c.red('✘')} ${c.bold(error.problem)}\n`);
  if (error.cause) process.stderr.write(`  ${c.dim('cause:')} ${error.cause}\n`);
  if (error.fix) process.stderr.write(`  ${c.dim('fix:')}   ${error.fix}\n`);
  if (error.docs) process.stderr.write(`  ${c.dim('docs:')}  ${c.cyan(error.docs)}\n`);
}

export function printSuccess(text: string): void {
  process.stdout.write(`${c.green('✓')} ${text}\n`);
}

export function printWhatsNext(items: Array<{ command: string; description: string }>): void {
  // The "what's next?" hint after every successful command.
  process.stdout.write(`\n${c.dim("What's next?")}\n`);
  for (const item of items) {
    process.stdout.write(`  ${c.cyan(item.command)}  ${c.dim(item.description)}\n`);
  }
}

/**
 * Lightweight key/value table. Avoids cli-table3 dep until we need
 * multi-column tabular output (P1 — workflow commands).
 */
export function printDetail(rows: Array<{ label: string; value: string }>): void {
  const labelWidth = Math.max(...rows.map(r => r.label.length));
  for (const row of rows) {
    const padded = row.label.padEnd(labelWidth);
    process.stdout.write(`  ${c.dim(padded)}  ${row.value}\n`);
  }
}
