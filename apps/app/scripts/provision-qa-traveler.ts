/**
 * Create a Clerk test-mode traveler (no org) and append it to
 * qa-logins.local.json so /me/wallet QA can sign in.
 *
 * Convention:
 *   email = `sendero+clerk_test_<unix_ms>@example.com`
 *   The `clerk_test_` substring flips Clerk dev mode into accepting
 *   `424242` for any 2FA challenge against this user.
 *
 * Sets `publicMetadata.kind = 'traveler'` so /me/* layout doesn't
 * redirect us away. Skips org membership so `auth().orgId` is null.
 *
 * Idempotent on label: re-running with the same --label updates the
 * existing qa-logins row rather than duplicating it.
 */

import { createClerkClient } from '@clerk/backend';
import fs from 'node:fs';
import path from 'node:path';

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY!,
});

interface QaUser {
  label: string;
  persona?: string;
  userId: string;
  email: string;
  password: string;
  notes?: Record<string, unknown>;
}

interface QaLogins {
  users: QaUser[];
  qaTeams?: unknown[];
}

const LABEL = process.argv.find(a => a.startsWith('--label='))?.split('=')[1] ?? 'QA Traveler Personal';
// qa-logins lives at the repo root, not the cwd of whichever package we run from.
function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'qa-logins.local.json'))) return dir;
    dir = path.dirname(dir);
  }
  return start;
}
const QA_LOGINS_PATH = path.join(findRepoRoot(process.cwd()), 'qa-logins.local.json');

function timestampMs(): number {
  return Date.now();
}

async function main() {
  const ts = timestampMs();
  const email = `sendero+clerk_test_${ts}@example.com`;
  const password = `SenderoTraveler2026!${ts.toString().slice(-4)}`;

  console.log(`Creating Clerk test-mode traveler:\n  email: ${email}\n  label: ${LABEL}`);

  // Create user with publicMetadata so the /me layout's `kind: 'traveler'`
  // backup-stamp is a no-op (already set).
  const username = `qa_traveler_${ts}`;
  const user = await clerkClient.users.createUser({
    emailAddress: [email],
    username,
    password,
    firstName: 'QA',
    lastName: 'Traveler',
    publicMetadata: { kind: 'traveler', senderoQa: true, persona: 'traveler-personal' },
    skipPasswordChecks: true,
    skipPasswordRequirement: false,
  });

  console.log(`Created Clerk user: ${user.id}`);

  // Append/update qa-logins.local.json
  const raw = fs.readFileSync(QA_LOGINS_PATH, 'utf8');
  const logins = JSON.parse(raw) as QaLogins;
  if (!Array.isArray(logins.users)) logins.users = [];

  const entry: QaUser = {
    label: LABEL,
    persona: 'traveler-personal',
    userId: user.id,
    email,
    password,
    notes: {
      senderoQa: true,
      orgBound: false,
      twoFactorBypass: 'clerk_test_<ts> in email enables 424242 acceptance',
      createdAt: new Date().toISOString(),
    },
  };

  const idx = logins.users.findIndex(u => u.label === LABEL);
  if (idx >= 0) {
    logins.users[idx] = entry;
    console.log(`Updated existing qa-logins entry: ${LABEL}`);
  } else {
    logins.users.push(entry);
    console.log(`Appended new qa-logins entry: ${LABEL}`);
  }

  fs.writeFileSync(QA_LOGINS_PATH, JSON.stringify(logins, null, 2) + '\n');
  console.log(`\n✓ Wrote ${QA_LOGINS_PATH}`);
  console.log('\nUse with /me/wallet QA:');
  console.log(`  email:    ${email}`);
  console.log(`  password: ${password}`);
  console.log(`  2fa code: 424242  (clerk_test_ email enables dev bypass)`);
}

main().catch(err => {
  // Surface Clerk API field errors verbatim — they tell us which
  // field tripped validation (e.g. password_complexity, breach).
  if (err && typeof err === 'object' && 'errors' in err) {
    console.error('Clerk error details:');
    console.error(JSON.stringify((err as { errors: unknown }).errors, null, 2));
  } else {
    console.error(err);
  }
  process.exit(1);
});
