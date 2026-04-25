/**
 * Environment variable access with explicit nullable getters. Callers
 * that need a credential are expected to surface a 503 when the getter
 * returns null — no silent demo fallbacks.
 */

export const env = {
  anthropicApiKey: () => process.env.ANTHROPIC_API_KEY || null,

  duffelApiToken: () => process.env.DUFFEL_API_TOKEN || null,
  duffelWebhookSecret: () => process.env.DUFFEL_WEBHOOK_SECRET || null,
  duffelEnv: () => (process.env.DUFFEL_ENV as 'test' | 'live') || 'test',
  svixToken: () => process.env.SVIX_TOKEN || null,
  svixServerUrl: () => process.env.SVIX_SERVER_URL || 'https://api.us.svix.com',

  circleApiKey: () => process.env.CIRCLE_API_KEY || null,
  circleEntitySecret: () =>
    process.env.CIRCLE_ENTITY_SECRET || process.env.CIRCLE_ENTITY_SECRET_CIPHERTEXT || null,
  circleWalletSetId: () => process.env.CIRCLE_WALLET_SET_ID || null,
  circleTreasuryWalletId: () => process.env.CIRCLE_TREASURY_WALLET_ID || null,
  circleTreasuryAddress: () => process.env.CIRCLE_TREASURY_ADDRESS || null,

  // Viem treasury (App Kit adapter). See lib/appkit.ts for why we need
  // a private-key EOA alongside the DCW custodial treasury.
  treasuryPrivateKey: () => process.env.TREASURY_PRIVATE_KEY || null,
  treasuryViemAddress: () => process.env.TREASURY_VIEM_ADDRESS || null,

  arcRpcUrl: () => process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network',
  // Arc Testnet canonical chain id per https://docs.arc.network
  arcChainId: () => Number(process.env.ARC_CHAIN_ID || 5042002),
  /**
   * Network mode. Arc is currently testnet-only (chain id 5042002).
   * `testnet-beta` means: paid plans + production API keys can be
   * created for UX plumbing, but no real USDC flows and no Clerk
   * Billing money collection (Clerk must be in development mode).
   * Flip to `production` the day Arc mainnet ships — we swap Clerk
   * to production keys in the same deploy.
   */
  networkMode: (): 'testnet-beta' | 'production' => {
    const override = process.env.SENDERO_NETWORK_MODE;
    if (override === 'production' || override === 'testnet-beta') return override;
    // Derive from chain id so a prod deploy pointed at Arc mainnet
    // flips automatically without an extra env knob.
    const chainId = Number(process.env.ARC_CHAIN_ID || 5042002);
    return chainId === 5042002 ? 'testnet-beta' : 'production';
  },
  isTestnetBeta: (): boolean => {
    const override = process.env.SENDERO_NETWORK_MODE;
    if (override === 'production') return false;
    if (override === 'testnet-beta') return true;
    return Number(process.env.ARC_CHAIN_ID || 5042002) === 5042002;
  },
  arcUsdcAddress: () =>
    process.env.ARC_USDC_ADDRESS || '0x3600000000000000000000000000000000000000',
  arcEurcAddress: () =>
    process.env.ARC_EURC_ADDRESS || '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
  arcExplorerUrl: () => process.env.ARC_EXPLORER_URL || 'https://testnet.arcscan.app',
  // Canonical: ARC_ESCROW_ADDRESS (matches the Foundry deploy script output).
  // Accepts SENDERO_GUEST_ESCROW / NEXT_PUBLIC_* as legacy fallbacks so
  // pre-Phase-9 .env files keep working.
  senderoGuestEscrowAddress: () =>
    (process.env.ARC_ESCROW_ADDRESS ||
      process.env.NEXT_PUBLIC_ARC_ESCROW_ADDRESS ||
      process.env.SENDERO_GUEST_ESCROW ||
      process.env.NEXT_PUBLIC_SENDERO_GUEST_ESCROW ||
      null) as `0x${string}` | null,
  senderoGuestEscrowDeployBlock: () => {
    const raw = process.env.ARC_ESCROW_DEPLOY_BLOCK;
    return raw ? Number(raw) : null;
  },
  senderoAgentTokenId: () =>
    process.env.SENDERO_AGENT_TOKEN_ID || process.env.SENDERO_AGENT_ID || null,
  senderoGuestLinkOrigin: () =>
    process.env.NEXT_PUBLIC_SENDERO_GUEST_LINK_ORIGIN || 'https://sendero.travel',

  // ── App access gates ─────────────────────────────────────────────────
  isBetaOpen: () => process.env.IS_BETA_OPEN || 'true',
  privateBetaWhitelist: () =>
    process.env.PRIVATE_BETA_WHITELIST ||
    process.env.PRIVATE_BETA_ALLOWLIST ||
    process.env.SENDERO_PRIVATE_BETA_WHITELIST ||
    null,

  // Circle Modular Wallets (user-side passkey auth). NOTE: The "Client Key"
  // Modular Wallets expects has the `TEST_CLIENT_KEY:` / `LIVE_CLIENT_KEY:`
  // prefix. `KIT_KEY:` values belong to App Kit / Swap Kit and will 401 here.
  modularClientKey: () =>
    process.env.NEXT_PUBLIC_CIRCLE_CLIENT_KEY ||
    process.env.NEXT_PUBLIC_CIRCLE_MODULAR_CLIENT_KEY ||
    null,
  modularClientUrl: () =>
    process.env.NEXT_PUBLIC_CIRCLE_CLIENT_URL ||
    process.env.NEXT_PUBLIC_CIRCLE_MODULAR_CLIENT_URL ||
    'https://modular-sdk.circle.com/v1/rpc/w3s/buidl',

  // ── Channels (Phase 2) ────────────────────────────────────────────
  whatsappAppSecret: () => process.env.WHATSAPP_APP_SECRET || null,
  whatsappVerifyToken: () => process.env.WHATSAPP_VERIFY_TOKEN || null,
  whatsappAccessToken: () => process.env.WHATSAPP_ACCESS_TOKEN || null,
  whatsappPhoneNumberId: () => process.env.WHATSAPP_PHONE_NUMBER_ID || null,
  whatsappApiBaseUrl: () => process.env.WHATSAPP_API_BASE_URL || null,
  whatsappDefaultCountry: () => process.env.WHATSAPP_DEFAULT_COUNTRY || 'US',
  /**
   * Dev-only last-resort fallback for inbound WA webhooks whose
   * phoneNumberId can't be mapped to a WhatsAppInstall row. Leave
   * unset in production — ops alerts on unresolved installs.
   */
  whatsappDefaultTenantId: () => process.env.WHATSAPP_DEFAULT_TENANT_ID || null,

  // ── BYO WhatsApp via Kapso (Phase 11h) ────────────────────────────
  kapsoApiKey: () => process.env.KAPSO_API_KEY || null,
  kapsoApiBaseUrl: () => process.env.KAPSO_API_BASE_URL || 'https://api.kapso.ai',
  /** Public URL Kapso posts BYO WhatsApp events to. Override in dev (ngrok). */
  kapsoWebhookBaseUrl: () =>
    process.env.KAPSO_WEBHOOK_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || null,
  /**
   * Project-scope webhook secret returned by Kapso when we register the
   * Sendero webhook. One value across all tenants — the Sendero project
   * is the unit Kapso signs against, not per-customer. Populate via
   * `bun scripts/register-kapso-webhook.ts` (one-shot).
   */
  kapsoWebhookSecret: () => process.env.KAPSO_WEBHOOK_SECRET || null,

  slackSigningSecret: () => process.env.SLACK_SIGNING_SECRET || null,
  slackClientId: () => process.env.SLACK_CLIENT_ID || null,
  slackClientSecret: () => process.env.SLACK_CLIENT_SECRET || null,
  slackRedirectUri: () => process.env.SLACK_REDIRECT_URI || null,
  slackStateSecret: () => process.env.SLACK_STATE_SECRET || null,

  resendWebhookSecret: () => process.env.RESEND_WEBHOOK_SECRET || null,

  // ── Concierge / in-trip companion ─────────────────────────────────
  googleMapsApiKey: () => process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY || null,
  googlePlacesApiKey: () => process.env.GOOGLE_API_KEY || null,

  // ── Invoicing (Phase 11b) ─────────────────────────────────────────
  invoiceSigningSecret: () => process.env.INVOICE_SIGNING_SECRET || null,

  // ── Pinata IPFS (NFT stamps — image + manifest pinning) ──────────
  // JWT is the full scoped-key bearer token from Pinata Console; SDK
  // needs only this. API key is kept for log/UI display so ops can
  // identify which scoped key is in use without printing the secret.
  // Gateway override for paid plans (custom subdomain) — defaults to
  // the public Pinata gateway.
  pinataJwt: () => process.env.PINATA_JWT || null,
  pinataApiKey: () => process.env.PINATA_API_KEY || null,
  pinataGateway: () => process.env.PINATA_GATEWAY || 'gateway.pinata.cloud',

  // ── App Kit · Unified Balance Kit (DCW outbound spends) ───────────
  /**
   * Hex private key for the Sendero delegate wallet that signs
   * `kit.unifiedBalance.spend()` calls on a traveler's behalf.  When
   * unset, `/api/transfer/spend` returns 503 with a "configure
   * delegate" message.  In production this should resolve from a
   * KMS-backed secret rather than an env var.
   */
  unifiedBalanceDelegateKey: () => process.env.SENDERO_UB_DELEGATE_PRIVATE_KEY || null,
};

export * from './require';
