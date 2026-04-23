import { SenderoSignIn } from '@sendero/auth/components/sign-in';

import { AuthShell } from '@/components/auth-shell';
import { PrivateBetaAccessCard } from '@/components/private-beta-access-card';
import { getAuthCopy } from '@/lib/auth-copy';
import { getPrivateBetaAccessState } from '@/lib/private-beta';
import { getRequestLocale } from '@/lib/request-locale';

type SignInPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const [locale, params, betaAccess] = await Promise.all([
    getRequestLocale(),
    searchParams,
    getPrivateBetaAccessState(),
  ]);
  const auth = getAuthCopy(locale);
  const copy = auth.signIn;
  const returnTo = authReturnPath('/sign-in', params);
  const showWaitlist = !betaAccess.canUseClerk && firstSearchParam(params.beta) === 'waitlist';

  return (
    <AuthShell
      title={copy.title}
      description={copy.description}
      asideTitle={copy.asideTitle}
      asideItems={copy.asideItems}
      canonicalPath="/sign-in"
      locale={locale}
    >
      {betaAccess.canUseClerk ? (
        <SenderoSignIn />
      ) : (
        <PrivateBetaAccessCard
          mode="sign-in"
          returnTo={returnTo}
          showWaitlist={showWaitlist}
          waitlistPrecheck={auth.waitlistPrecheck}
        />
      )}
    </AuthShell>
  );
}

function authReturnPath(path: '/sign-in', params: Record<string, string | string[] | undefined>) {
  const url = new URL(path, 'https://sendero.local');
  const redirectUrl = firstSearchParam(params.redirect_url);
  if (redirectUrl) url.searchParams.set('redirect_url', redirectUrl);
  return `${url.pathname}${url.search}`;
}

function firstSearchParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
