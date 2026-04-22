import { SenderoSignUp } from '@sendero/auth/components/sign-up';
import { AuthShell } from '@/components/auth-shell';
import { getAuthCopy } from '@/lib/auth-copy';
import { getRequestLocale } from '@/lib/request-locale';

export default async function SignUpPage() {
  const locale = await getRequestLocale();
  const copy = getAuthCopy(locale).signUp;

  return (
    <AuthShell
      title={copy.title}
      description={copy.description}
      asideTitle={copy.asideTitle}
      asideItems={copy.asideItems}
      locale={locale}
    >
      <SenderoSignUp />
    </AuthShell>
  );
}
