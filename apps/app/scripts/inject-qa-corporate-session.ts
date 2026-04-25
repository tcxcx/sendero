/**
 * Mint a Clerk session for QA Corporate via the backend API and print
 * the session JWT so headless browse can drop it as the __session cookie.
 *
 * Run:  bun scripts/inject-qa-corporate-session.ts
 */

import { createClerkClient } from '@clerk/backend';

const QA_CORPORATE_USER_ID = 'user_3Ch6n9weA3KflcBOm22hb6g4Upn';

async function main() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error('CLERK_SECRET_KEY required');

  const clerk = createClerkClient({ secretKey });

  // 1. Create the session (server-side, no UI flow).
  const session = await clerk.sessions.createSession({
    userId: QA_CORPORATE_USER_ID,
  });

  // 2. Get a JWT for the session (the value Clerk's frontend stores
  //    under the `__session` cookie).
  const jwt = await clerk.sessions.getToken(session.id, '');

  console.log(`sessionId: ${session.id}`);
  console.log(`__session: ${jwt.jwt}`);
  console.log(`expiresAt: ${new Date(session.expireAt).toISOString()}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
