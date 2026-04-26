/**
 * Generate a Clerk sign-in token for QA Corporate so headless browse
 * can authenticate without going through the email-verification UI.
 *
 * Output is a URL that, when visited once, completes sign-in.
 *
 * Run:  bun scripts/sign-in-as-qa-corporate.ts
 */

import { createClerkClient } from '@clerk/backend';

const QA_CORPORATE_USER_ID = 'user_3Ch6n9weA3KflcBOm22hb6g4Upn';

async function main() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error('CLERK_SECRET_KEY required');

  const clerk = createClerkClient({ secretKey });

  const tok = await clerk.signInTokens.createSignInToken({
    userId: QA_CORPORATE_USER_ID,
    expiresInSeconds: 60 * 10,
  });

  // Compose the verify URL. Clerk's hosted Account Portal accepts the
  // token via /verify?__clerk_ticket=<token>; for embedded sign-in flows
  // we hit the redirect URL directly.
  const appOrigin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3010';
  const target = `${appOrigin}/sign-in/factor-one?__clerk_ticket=${tok.token}&__clerk_status=sign_in&redirect_url=${encodeURIComponent('/dashboard/console')}`;

  console.log(`Sign-in token (expires 10m): ${tok.token}`);
  console.log(`URL to visit: ${target}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
