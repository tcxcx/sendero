/**
 * Credential + preferences store with profile support.
 *
 * Layout (v0.2):
 *   ~/.sendero/
 *   ├── current                  → name of active profile (default: "default")
 *   ├── prefs.json               → global prefs ({ defaultFormat? })
 *   └── profiles/
 *       ├── default.json         → { apiKey, apiUrl?, mintedAt? } (0o600)
 *       ├── prod.json
 *       └── staging.json
 *
 * Migration from v0.1:
 *   ~/.sendero/key (single file) → ~/.sendero/profiles/default.json
 *   Idempotent. Old key file removed AFTER successful migration write.
 *   If migration fails, both files coexist; readKey falls through to legacy.
 *
 * Env precedence (unchanged):
 *   SENDERO_API_KEY (env) > active profile > legacy ~/.sendero/key
 *   SENDERO_PROFILE (env) overrides which profile is "active" for one run.
 *
 * Permissions: dir 0o700, every file 0o600. The dir-perm matters even with
 * locked files — a world-readable dir leaks the install's existence.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SENDERO_DIR = join(homedir(), '.sendero');
const PROFILES_DIR = join(SENDERO_DIR, 'profiles');
const CURRENT_FILE = join(SENDERO_DIR, 'current');
const PREFS_FILE = join(SENDERO_DIR, 'prefs.json');
const LEGACY_KEY_FILE = join(SENDERO_DIR, 'key');

const KEY_FORMAT_RE = /^ak_[A-Za-z0-9_-]{16,}$/;

export interface Profile {
  apiKey: string;
  apiUrl?: string;
  mintedAt?: string;
}

export interface Prefs {
  defaultFormat?: 'json' | 'table';
}

function ensureDirs(): void {
  mkdirSync(SENDERO_DIR, { recursive: true, mode: 0o700 });
  mkdirSync(PROFILES_DIR, { recursive: true, mode: 0o700 });
}

function profilePath(name: string): string {
  return join(PROFILES_DIR, `${sanitizeProfileName(name)}.json`);
}

/**
 * Profile names hit the filesystem — refuse anything that could escape
 * the profiles dir or shell-quote awkwardly. Allow only [A-Za-z0-9_-].
 */
function sanitizeProfileName(name: string): string {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(name)) {
    throw new Error(
      `Invalid profile name "${name}". Use 1-32 chars: letters, digits, underscore, dash.`
    );
  }
  return name;
}

/**
 * Migrate legacy `~/.sendero/key` → `~/.sendero/profiles/default.json`.
 * Idempotent: if the migration already ran (default.json exists OR
 * legacy file is gone), this is a no-op. Failures are non-fatal — the
 * legacy file stays, and the legacy read path picks it up.
 */
function maybeMigrate(): void {
  if (!existsSync(LEGACY_KEY_FILE)) return;
  if (existsSync(profilePath('default'))) {
    // Already migrated. Drop the legacy file now; the profile is
    // canonical going forward.
    try {
      unlinkSync(LEGACY_KEY_FILE);
    } catch {
      // Non-fatal — read path skips legacy when default.json exists.
    }
    return;
  }
  try {
    const raw = readFileSync(LEGACY_KEY_FILE, 'utf8').trim();
    if (!raw) return; // empty — treat as unmigratable
    ensureDirs();
    const profile: Profile = { apiKey: raw, mintedAt: new Date().toISOString() };
    writeFileSync(profilePath('default'), JSON.stringify(profile, null, 2), { mode: 0o600 });
    if (!existsSync(CURRENT_FILE)) {
      writeFileSync(CURRENT_FILE, 'default\n', { mode: 0o600 });
    }
    // Migration complete — remove legacy. If this throws, the next
    // ensureProfile() pass will re-detect and clean up.
    unlinkSync(LEGACY_KEY_FILE);
  } catch (err) {
    // Logged to stderr so the user sees the migration attempt without it
    // blocking the actual command they ran.
    process.stderr.write(
      `[sendero] Note: failed to migrate legacy key file (${err instanceof Error ? err.message : 'unknown'}). Falling back to legacy read path.\n`
    );
  }
}

export function activeProfileName(): string {
  if (process.env.SENDERO_PROFILE) return sanitizeProfileName(process.env.SENDERO_PROFILE);
  if (!existsSync(CURRENT_FILE)) return 'default';
  const name = readFileSync(CURRENT_FILE, 'utf8').trim();
  return name ? sanitizeProfileName(name) : 'default';
}

export function readProfile(name: string = activeProfileName()): Profile | null {
  maybeMigrate();
  const path = profilePath(name);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Profile;
  } catch {
    return null;
  }
}

export function writeProfile(name: string, profile: Profile): void {
  ensureDirs();
  if (!isValidKeyShape(profile.apiKey)) {
    throw new Error('writeProfile: apiKey is not a valid Sendero key shape');
  }
  writeFileSync(
    profilePath(name),
    JSON.stringify(profile, null, 2),
    { mode: 0o600 }
  );
}

export function deleteProfile(name: string): boolean {
  const path = profilePath(name);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  // If we just deleted the active profile, fall back to default.
  if (activeProfileName() === name && name !== 'default') {
    setActiveProfile('default');
  }
  return true;
}

export function setActiveProfile(name: string): void {
  ensureDirs();
  // Don't allow setting active to a profile that doesn't exist — would
  // silently break every subsequent command.
  if (!existsSync(profilePath(sanitizeProfileName(name)))) {
    throw new Error(`Profile "${name}" not found. Run \`sendero auth login --profile ${name}\` first.`);
  }
  writeFileSync(CURRENT_FILE, `${sanitizeProfileName(name)}\n`, { mode: 0o600 });
}

export function listProfiles(): string[] {
  if (!existsSync(PROFILES_DIR)) return [];
  return readdirSync(PROFILES_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.slice(0, -5))
    .sort();
}

/**
 * Read the API key for the active profile (or env override).
 *
 * Precedence:
 *   1. SENDERO_API_KEY env (highest)
 *   2. Active profile's apiKey
 *   3. Legacy ~/.sendero/key file (only if no profile exists)
 */
export function readKey(): string | null {
  if (process.env.SENDERO_API_KEY) return process.env.SENDERO_API_KEY;
  maybeMigrate();
  const profile = readProfile();
  if (profile?.apiKey) return profile.apiKey;
  // Legacy fallback — ONLY hit if migration failed or hasn't run.
  if (existsSync(LEGACY_KEY_FILE)) {
    return readFileSync(LEGACY_KEY_FILE, 'utf8').trim() || null;
  }
  return null;
}

/**
 * Write a key to the active profile. Used by both `auth login` (after
 * OAuth/paste) and the bootstrap path on first run.
 */
export function writeKey(key: string): void {
  ensureDirs();
  if (!isValidKeyShape(key)) {
    throw new Error('writeKey: invalid key shape');
  }
  const name = activeProfileName();
  const existing = readProfile(name);
  const profile: Profile = {
    apiKey: key,
    apiUrl: existing?.apiUrl,
    mintedAt: new Date().toISOString(),
  };
  writeProfile(name, profile);
}

export function clearKey(): void {
  const name = activeProfileName();
  const path = profilePath(name);
  if (!existsSync(path)) return;
  unlinkSync(path);
}

export function isValidKeyShape(key: string): boolean {
  return KEY_FORMAT_RE.test(key);
}

export function readPrefs(): Prefs {
  if (!existsSync(PREFS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(PREFS_FILE, 'utf8')) as Prefs;
  } catch {
    return {};
  }
}

export function writePrefs(prefs: Prefs): void {
  ensureDirs();
  writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2), { mode: 0o600 });
}

export const paths = {
  dir: SENDERO_DIR,
  profilesDir: PROFILES_DIR,
  currentFile: CURRENT_FILE,
  prefsFile: PREFS_FILE,
  legacyKeyFile: LEGACY_KEY_FILE,
  profile: profilePath,
};
