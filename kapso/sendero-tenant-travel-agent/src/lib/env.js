import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadLocalEnv(rootDir, fileName = '.env.local') {
  const path = resolve(rootDir, fileName);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const raw = trimmed.slice(eq + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^['"]|['"]$/g, '');
  }
}

export function getRequiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

export function getOptionalEnv(name) {
  const value = process.env[name]?.trim();
  return value || null;
}
