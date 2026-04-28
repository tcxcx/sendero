/**
 * Spinner wrapper. No-ops when --quiet, --agent, or stdout isn't a TTY.
 *
 * Reasons to avoid the spinner:
 * - --agent mode (parsing JSON output, ANSI cursor codes corrupt the stream)
 * - --quiet (user explicitly said don't)
 * - non-TTY (CI logs, piped output — same reason as agent)
 */

import ora, { type Ora } from 'ora';
import { isTTY } from '../output/formatter';

interface SpinnerOpts {
  quiet?: boolean;
  agent?: boolean;
}

export async function withSpinner<T>(
  text: string,
  fn: () => Promise<T>,
  opts: SpinnerOpts = {}
): Promise<T> {
  const muted = opts.quiet || opts.agent || !isTTY();
  if (muted) return fn();

  const spinner: Ora = ora(text).start();
  try {
    const result = await fn();
    spinner.succeed();
    return result;
  } catch (err) {
    spinner.fail();
    throw err;
  }
}
