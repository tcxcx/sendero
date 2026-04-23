import { SenderoSignUp } from '@sendero/auth/components/sign-up';

import { AuthShell } from '@/components/auth-shell';
import { PrivateBetaAccessCard } from '@/components/private-beta-access-card';
import { getAuthCopy } from '@/lib/auth-copy';
import { getPrivateBetaAccessState } from '@/lib/private-beta';
import { getRequestLocale } from '@/lib/request-locale';

type SignUpPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const [locale, params, betaAccess] = await Promise.all([
    getRequestLocale(),
    searchParams,
    getPrivateBetaAccessState(),
  ]);
  const auth = getAuthCopy(locale);
  const copy = auth.signUp;
  const showWaitlist = !betaAccess.canUseClerk && firstSearchParam(params.beta) === 'waitlist';

  return (
    <AuthShell
      title={copy.title}
      description={copy.description}
      asideTitle={copy.asideTitle}
      asideItems={copy.asideItems}
      canonicalPath="/sign-up"
      locale={locale}
    >
      {betaAccess.canUseClerk ? (
        <SenderoSignUp />
      ) : (
        <PrivateBetaAccessCard
          mode="sign-up"
          returnTo="/sign-up"
          showWaitlist={showWaitlist}
          waitlistPrecheck={auth.waitlistPrecheck}
        />
      )}
    </AuthShell>
  );
}

function firstSearchParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
