// Global TypeScript augmentation for Clerk session claims.
// Clerk's session token is customized via the Dashboard (Sessions → Customize
// session token) to include: metadata (from user.public_metadata) and
// org_metadata (from org.public_metadata). These claims are what our
// middleware + pages read to gate on onboardingComplete + arcWalletAddress.

export {};

declare global {
  interface CustomJwtSessionClaims {
    metadata?: {
      preferredChannelId?: string;
    };
    org_metadata?: {
      tenantId?: string;
      arcWalletAddress?: `0x${string}`;
      onboardingComplete?: boolean;
    };
  }
}
