/**
 * Traveler sign-in surface — `/sign-in/traveler`.
 *
 * Distinct from the operator `/sign-in` (which lands on `/dashboard`).
 * The traveler flow:
 *   1. Phone OTP via Clerk (free tier — no custom roles needed).
 *   2. After auth, fallbackRedirectUrl bounces to
 *      `/api/whatsapp/link-clerk?token=…` when a `?token=` query param is
 *      present (the agent's SIGN_IN_BEFORE_BOOKING template embeds it).
 *      The route runs the WhatsAppLinkToken → User merge and lands the
 *      traveler at `/me`.
 *   3. With no token (organic sign-in), the user lands on `/me` directly.
 *
 * No org affiliation is asked for or assigned. Travelers are
 * `User.publicMetadata.kind = 'traveler'` (set by the redemption route).
 */

import { auth } from '@clerk/nextjs/server';
import { ClerkLoaded, ClerkLoading, SignIn } from '@clerk/nextjs';
import { redirect } from 'next/navigation';

import { ClerkFormSkeleton } from '@sendero/auth/components/clerk-form-skeleton';

export const dynamic = 'force-dynamic';

interface TravelerSignInProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function TravelerSignInPage({ searchParams }: TravelerSignInProps) {
  // Operators (org-bound users) shouldn't land on the traveler sign-in
  // surface in the organic case — bounce them to their dashboard so
  // the org context isn't lost. BUT when a `?token=` is present the
  // operator is intentionally redeeming a WhatsApp magic link
  // (founder-as-traveler demo + real operators who also book trips on
  // their own phone). The /api/whatsapp/link-clerk redemption route
  // handles merging the placeholder traveler User into their Clerk
  // identity without disturbing org memberships.
  const { orgId } = await auth();
  const params = await searchParams;
  const tokenRaw = params.token;
  const token =
    typeof tokenRaw === 'string' ? tokenRaw : Array.isArray(tokenRaw) ? tokenRaw[0] : '';
  if (orgId && !token) redirect('/dashboard');

  // Always route through /api/whatsapp/link-clerk after sign-in. With a
  // token: redeems and merges the placeholder. Without: stamps the
  // traveler-kind metadata so the proxy treats the new user as B2C
  // before they can drift into operator routes.
  const fallbackRedirectUrl = token
    ? `/api/whatsapp/link-clerk?token=${encodeURIComponent(token)}`
    : '/api/whatsapp/link-clerk';

  return (
    <main className="mx-auto flex min-h-screen max-w-[480px] flex-col items-center justify-center gap-8 px-6 py-12">
      <header className="flex flex-col items-center gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Sendero · me</p>
        <h1 className="font-display text-2xl">Sign in to your traveler portal</h1>
        <p className="text-center text-sm text-muted-foreground">
          One identity that follows you across every Sendero-powered tenant.
        </p>
      </header>

      <ClerkLoading>
        <ClerkFormSkeleton />
      </ClerkLoading>
      <ClerkLoaded>
        <SignIn
          routing="path"
          path="/sign-in/traveler"
          signUpUrl="/sign-in/traveler"
          fallbackRedirectUrl={fallbackRedirectUrl}
          signUpFallbackRedirectUrl={fallbackRedirectUrl}
          appearance={{
            elements: {
              rootBox: '!w-full',
              cardBox: '!w-full !max-w-none',
              header: 'hidden',
              footer: 'hidden',
            },
          }}
        />
      </ClerkLoaded>
    </main>
  );
}
