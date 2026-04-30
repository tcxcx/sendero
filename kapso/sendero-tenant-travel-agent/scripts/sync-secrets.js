import { FUNCTION_SLUGS } from '../src/lib/constants.js';
import { getOptionalEnv, loadLocalEnv } from '../src/lib/env.js';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

loadLocalEnv(process.cwd());

const secretNames = [
  'SENDERO_APP_ORIGIN',
  'SUPPORT_TOOLS_SECRET',
  'KAPSO_WEBHOOK_SECRET',
  'KAPSO_WEBHOOK_BASE_URL',
];

for (const slug of Object.values(FUNCTION_SLUGS)) {
  for (const name of secretNames) {
    const value = getOptionalEnv(name);
    if (!value) continue;
    execFileSync('kapso', ['functions', 'secrets', 'set', slug, name, value], {
      cwd: resolve(process.cwd()),
      stdio: 'inherit',
    });
  }
}
