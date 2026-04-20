'use client';

/**
 * Circle Modular Wallets passkey client — browser-only.
 *
 * We run the WebAuthn ceremony LOCALLY (`navigator.credentials.create`/`.get`)
 * instead of going through Circle's hosted passkey transport. This avoids
 * the "relying party ID is not a registrable domain suffix" error on
 * localhost and works on any domain without Circle-side Passkey Domain
 * configuration.
 *
 * Once we have an `{ id, publicKey }` P256 credential, we hand it to
 * `toCircleSmartAccount` via `toWebAuthnAccount` — that derives the MSCA
 * address + signs user operations with paymaster-sponsored gas.
 */

import { createPublicClient, type Hex } from 'viem';
import { arcTestnet } from 'viem/chains';
import {
  type SmartAccount,
  type WebAuthnAccount,
  createBundlerClient,
  toWebAuthnAccount,
} from 'viem/account-abstraction';
import { toCircleSmartAccount } from '@circle-fin/modular-wallets-core';
import {
  parseCredentialPublicKey,
  serializePublicKey,
} from 'webauthn-p256';
import { toModularTransport } from '@circle-fin/modular-wallets-core';

const CRED_KEY = 'sendero:passkey-credential';
const PROFILE_KEY = 'sendero:passkey-profile';

export interface StoredCredential {
  id: string;
  publicKey: Hex;
  rpId: string;
}

export interface UserProfile {
  displayName: string;
  email: string;
  phone: string;
}

export interface UserWallet {
  credential: StoredCredential;
  account: SmartAccount;
  address: Hex;
  displayName: string;
  email: string;
  phone: string;
}

// ── env + transport ───────────────────────────────────────────────────

function env() {
  const clientKey =
    process.env.NEXT_PUBLIC_CIRCLE_CLIENT_KEY ||
    process.env.NEXT_PUBLIC_CIRCLE_MODULAR_CLIENT_KEY ||
    '';
  const clientUrl =
    process.env.NEXT_PUBLIC_CIRCLE_CLIENT_URL ||
    process.env.NEXT_PUBLIC_CIRCLE_MODULAR_CLIENT_URL ||
    'https://modular-sdk.circle.com/v1/rpc/w3s/buidl';
  return { clientKey, clientUrl };
}

export function isPasskeyConfigured(): boolean {
  const { clientKey } = env();
  if (!clientKey) return false;
  return (
    clientKey.startsWith('TEST_CLIENT_KEY:') ||
    clientKey.startsWith('LIVE_CLIENT_KEY:')
  );
}

export function passkeyConfigIssue(): string | null {
  const { clientKey } = env();
  if (!clientKey) {
    return 'NEXT_PUBLIC_CIRCLE_CLIENT_KEY not set. Generate a Modular Wallets client key at https://console.circle.com and add it to .env.local.';
  }
  if (clientKey.startsWith('KIT_KEY:')) {
    return 'Client key has KIT_KEY: prefix — that belongs to App Kit / Swap Kit, not Modular Wallets. Generate a TEST_CLIENT_KEY under Circle Console → Modular Wallets → Client Keys.';
  }
  if (
    !clientKey.startsWith('TEST_CLIENT_KEY:') &&
    !clientKey.startsWith('LIVE_CLIENT_KEY:')
  ) {
    return 'Client key format unrecognized. Expected TEST_CLIENT_KEY:<id>:<secret> from Circle Console → Modular Wallets.';
  }
  return null;
}

function ensureConfigured() {
  const issue = passkeyConfigIssue();
  if (issue) throw new Error(issue);
}

// Arc Testnet's bundler rejects userOps with maxPriorityFeePerGas below 1 gwei
// (precheck: "maxPriorityFeePerGas … must be at least 1000000000"). Viem's
// default estimateFeesPerGas returns values far below that floor, so we need
// to override the bundler's fee estimator to bump up.
const ARC_MIN_PRIORITY_FEE_PER_GAS = 1_000_000_000n;

function clients() {
  ensureConfigured();
  const { clientKey, clientUrl } = env();
  const modular = toModularTransport(
    `${clientUrl}/arcTestnet`,
    clientKey,
  );
  const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: modular,
  });
  const bundlerClient = createBundlerClient({
    chain: arcTestnet,
    transport: modular,
    userOperation: {
      estimateFeesPerGas: async () => {
        const estimated = await publicClient.estimateFeesPerGas({
          chain: arcTestnet,
          type: 'eip1559',
        });
        // 2x buffer, then floor to the bundler minimum.
        const priority =
          estimated.maxPriorityFeePerGas * 2n >= ARC_MIN_PRIORITY_FEE_PER_GAS
            ? estimated.maxPriorityFeePerGas * 2n
            : ARC_MIN_PRIORITY_FEE_PER_GAS;
        const base = estimated.maxFeePerGas * 2n;
        return {
          maxPriorityFeePerGas: priority,
          // maxFee must be >= priority; add the delta if our 2x base
          // was below the floored priority.
          maxFeePerGas: base >= priority ? base : priority + base,
        };
      },
    },
  });
  return { publicClient, bundlerClient };
}

// ── local WebAuthn ceremonies ─────────────────────────────────────────

function rpForCurrentOrigin(): { id: string; name: string } {
  if (typeof window === 'undefined') {
    return { id: 'localhost', name: 'Sendero · Arc' };
  }
  return {
    id: window.location.hostname,
    name: document.title || 'Sendero · Arc',
  };
}

async function createLocalPasskey(
  displayName: string,
): Promise<StoredCredential> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) {
    throw new Error('WebAuthn is not supported in this environment.');
  }
  const { id: rpId, name: rpName } = rpForCurrentOrigin();
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { id: rpId, name: rpName },
      user: {
        id: userId,
        name: displayName,
        displayName,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256 (P-256)
        { type: 'public-key', alg: -257 }, // RS256 fallback — viem only consumes -7
      ],
      authenticatorSelection: {
        userVerification: 'preferred',
        residentKey: 'preferred',
        requireResidentKey: false,
      },
      timeout: 60_000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null;

  if (!credential || credential.type !== 'public-key') {
    throw new Error('Passkey registration did not return a valid credential.');
  }

  const response = credential.response as AuthenticatorAttestationResponse;
  const publicKeyBuf = response.getPublicKey?.();
  if (!publicKeyBuf) {
    throw new Error('Authenticator did not expose a raw public key (required).');
  }

  const publicKey = serializePublicKey(
    await parseCredentialPublicKey(publicKeyBuf),
    { compressed: false },
  ) as Hex;

  return { id: credential.id, publicKey, rpId };
}

async function assertLocalPasskey(
  credentialId?: string,
  rpId?: string,
): Promise<string> {
  // We don't actually need the assertion result for login — we already have
  // the public key stored. We just use this ceremony to confirm the user can
  // still authenticate with the credential on this device before restoring.
  const rp = rpId ?? rpForCurrentOrigin().id;
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: rp,
      userVerification: 'preferred',
      allowCredentials: credentialId
        ? [
            {
              type: 'public-key' as const,
              id: base64UrlToBytes(credentialId).buffer as ArrayBuffer,
            },
          ]
        : undefined,
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!assertion) throw new Error('Passkey assertion failed.');
  return assertion.id;
}

function base64UrlToBytes(input: string): Uint8Array {
  const pad = '='.repeat((4 - (input.length % 4)) % 4);
  const b64 = (input + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── MSCA derivation ───────────────────────────────────────────────────

/**
 * Deterministic wallet name for `toCircleSmartAccount`.
 *
 * Circle's default `getDefaultWalletName(owner)` returns
 * `passkey-${new Date().toISOString()}` — random every call, producing a
 * DIFFERENT MSCA address each session. Using `displayName` isn't stable
 * either: if PROFILE_KEY drops but the credential persists, the name
 * changes and the MSCA address drifts.
 *
 * Derive the name from the WebAuthn credential id + public key so the
 * same passkey always resolves to the same MSCA.
 */
function stableWalletName(credential: StoredCredential): string {
  const idSlug = credential.id.replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
  const pkSuffix = credential.publicKey.slice(-8);
  return `sendero-${idSlug}-${pkSuffix}`;
}

async function smartAccountFromCredential(
  credential: StoredCredential,
): Promise<{ account: SmartAccount; address: Hex }> {
  const { publicClient } = clients();
  const account = await (toCircleSmartAccount as any)({
    client: publicClient,
    owner: toWebAuthnAccount({
      credential: { id: credential.id, publicKey: credential.publicKey },
      rpId: credential.rpId,
    }) as WebAuthnAccount,
    name: stableWalletName(credential),
  });
  return { account, address: account.address as Hex };
}

// ── public API ────────────────────────────────────────────────────────

export async function registerPasskey(
  profile: UserProfile,
): Promise<UserWallet> {
  ensureConfigured();
  const credential = await createLocalPasskey(profile.displayName);
  const { account, address } = await smartAccountFromCredential(credential);
  persist(credential, profile);
  return {
    credential,
    account,
    address,
    displayName: profile.displayName,
    email: profile.email,
    phone: profile.phone,
  };
}

export async function loginPasskey(): Promise<UserWallet> {
  ensureConfigured();
  const stored = loadStoredCredential();
  if (!stored) {
    throw new Error(
      'No passkey on this device. Use "Create a passkey" first.',
    );
  }
  // Confirm the user can still authenticate with it.
  await assertLocalPasskey(stored.id, stored.rpId);
  const profile = loadProfile() ?? {
    displayName: shortAddr(stored.id),
    email: '',
    phone: '',
  };
  const { account, address } = await smartAccountFromCredential(stored);
  persist(stored, profile);
  return { credential: stored, account, address, ...profile };
}

export async function restoreFromStorage(): Promise<UserWallet | null> {
  if (typeof window === 'undefined') return null;
  const stored = loadStoredCredential();
  if (!stored) return null;
  try {
    const profile = loadProfile() ?? {
      displayName: shortAddr(stored.id),
      email: '',
      phone: '',
    };
    const { account, address } = await smartAccountFromCredential(stored);
    return { credential: stored, account, address, ...profile };
  } catch (err) {
    console.warn('[user-wallet] restoreFromStorage failed:', err);
    return null;
  }
}

export function logout(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(CRED_KEY);
  window.localStorage.removeItem(PROFILE_KEY);
}

export async function sendUserOp(
  wallet: UserWallet,
  calls: Array<{ to: Hex; data: Hex; value?: bigint }>,
): Promise<{ txHash: Hex; userOpHash: Hex }> {
  const { bundlerClient } = clients();
  const userOpHash = await bundlerClient.sendUserOperation({
    account: wallet.account,
    calls: calls as any,
    paymaster: true,
  });
  const { receipt } = await bundlerClient.waitForUserOperationReceipt({
    hash: userOpHash,
  });
  return { txHash: receipt.transactionHash as Hex, userOpHash };
}

// ── helpers ────────────────────────────────────────────────────────────

function persist(credential: StoredCredential, profile: UserProfile) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(CRED_KEY, JSON.stringify(credential));
  window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

function loadStoredCredential(): StoredCredential | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(CRED_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.id === 'string' &&
      typeof parsed.publicKey === 'string'
    ) {
      return {
        id: parsed.id,
        publicKey: parsed.publicKey as Hex,
        rpId: parsed.rpId ?? rpForCurrentOrigin().id,
      };
    }
  } catch {
    /* fall through */
  }
  window.localStorage.removeItem(CRED_KEY);
  return null;
}

function loadProfile(): UserProfile | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(PROFILE_KEY);
  if (!raw) {
    // Migrate from older single-field storage ("sendero:passkey-display-name").
    const legacy = window.localStorage.getItem('sendero:passkey-display-name');
    if (legacy) return { displayName: legacy, email: '', phone: '' };
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.displayName === 'string') {
      return {
        displayName: parsed.displayName,
        email: typeof parsed.email === 'string' ? parsed.email : '',
        phone: typeof parsed.phone === 'string' ? parsed.phone : '',
      };
    }
  } catch {
    /* fall through */
  }
  return null;
}

function shortAddr(s: string): string {
  if (!s || s.length < 8) return s || 'passkey user';
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}
