import { SenderoSignIn } from '@sendero/auth/components/sign-in';
import { AuthShell } from '@/components/auth-shell';
import { getAuthCopy } from '@/lib/auth-copy';
import { getRequestLocale } from '@/lib/request-locale';

export default async function SignInPage() {
  const locale = await getRequestLocale();
  const copy = getAuthCopy(locale).signIn;

  return (
    <AuthShell
      title={copy.title}
      description={copy.description}
      asideTitle={copy.asideTitle}
      asideItems={copy.asideItems}
      locale={locale}
    >
      <SenderoSignIn />
    </AuthShell>
  );
}
