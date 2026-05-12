#!/usr/bin/env bun
/**
 * Mint a Better Auth dev session for an existing user — bypasses OAuth
 * so headless / automation flows can hit authed routes. Prints a single
 * line: `<cookie-name>=<cookie-value>` ready to paste into a browser.
 *
 * Usage: bun --env-file=.env.local scripts/mint-dev-session.ts <userId>
 */

import { nanoid } from "nanoid";
import postgres from "postgres";

const userId = process.argv[2];
if (!userId) {
  console.error("usage: mint-dev-session.ts <userId>");
  process.exit(1);
}
const url = process.env.POSTGRES_URL;
const secret = process.env.BETTER_AUTH_SECRET;
if (!url || !secret) {
  console.error("POSTGRES_URL + BETTER_AUTH_SECRET required");
  process.exit(1);
}

const client = postgres(url, { max: 1 });
try {
  const exists = await client`SELECT id FROM users WHERE id = ${userId}`;
  if (exists.length === 0) {
    console.error(`user ${userId} not found`);
    process.exit(1);
  }

  const token = nanoid(32);
  const id = nanoid();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  await client`
    INSERT INTO auth_sessions (id, expires_at, token, user_id, ip_address, user_agent)
    VALUES (${id}, ${expiresAt}, ${token}, ${userId}, '127.0.0.1', 'dev-mint')
  `;

  // Match Hono's makeSignature: HMAC-SHA256(token, secret) → base64.
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(token),
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  const cookieValue = `${token}.${sigB64}`;

  // Better Auth's default cookie name for the session token.
  console.log(`better-auth.session_token=${encodeURIComponent(cookieValue)}`);
  console.error(`Session id: ${id} · expires ${expiresAt.toISOString()}`);
} finally {
  await client.end();
}
