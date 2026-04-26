/**
 * Disable MFA on the QA Corporate user so headless browse can sign in.
 *
 * Run:  bun scripts/disable-qa-corporate-mfa.ts
 */

import { createClerkClient } from '@clerk/backend';

const QA_CORPORATE_USER_ID = 'user_3Ch6n9weA3KflcBOm22hb6g4Upn';

async function main() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error('CLERK_SECRET_KEY required');

  const clerk = createClerkClient({ secretKey });

  const user = await clerk.users.getUser(QA_CORPORATE_USER_ID);
  console.log(`User: ${user.id} ${user.emailAddresses[0]?.emailAddress}`);
  console.log(`  twoFactorEnabled: ${user.twoFactorEnabled}`);
  console.log(`  totpEnabled: ${user.totpEnabled}`);
  console.log(`  backupCodeEnabled: ${user.backupCodeEnabled}`);

  // Pull every second-factor verification (TOTP, backup, phone, email-2fa).
  // The backend SDK's typed surface varies across versions; fall back to
  // the raw API client where the typed method isn't exposed.
  const cAny = clerk as any;
  if (user.totpEnabled && typeof cAny.users?.disableUserTOTP === 'function') {
    await cAny.users.disableUserTOTP(QA_CORPORATE_USER_ID);
    console.log('  → TOTP disabled');
  }

  // Email-code 2FA is exposed as the email's `reservedForSecondFactor` flag.
  // Older SDK signatures don't include it in the update params type — cast.
  for (const e of user.emailAddresses) {
    if ((e as any).reservedForSecondFactor) {
      await cAny.emailAddresses.updateEmailAddress(e.id, {
        reservedForSecondFactor: false,
      });
      console.log(`  → email ${e.emailAddress} unflagged as second factor`);
    }
  }

  // Same for phone-based SMS 2FA.
  for (const p of user.phoneNumbers) {
    if ((p as any).reservedForSecondFactor) {
      await cAny.phoneNumbers.updatePhoneNumber(p.id, {
        reservedForSecondFactor: false,
      });
      console.log(`  → phone ${p.phoneNumber} unflagged as second factor`);
    }
  }

  const after = await clerk.users.getUser(QA_CORPORATE_USER_ID);
  console.log(`\nFinal state:`);
  console.log(`  twoFactorEnabled: ${after.twoFactorEnabled}`);
  console.log(`  totpEnabled: ${after.totpEnabled}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
