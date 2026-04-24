import { AuthShell } from '@/components/auth-shell';
import { WaitlistCard } from '@/components/waitlist-card';
import { getAuthCopy } from '@/lib/auth-copy';
import { getRequestLocale } from '@/lib/request-locale';

export default async function WaitlistPage() {
  const locale = await getRequestLocale();
  const auth = getAuthCopy(locale);
  const copy = auth.waitlist;

  return (
    <AuthShell
      title={copy.title}
      description={copy.description}
      asideTitle={copy.asideTitle}
      asideItems={copy.asideItems}
      canonicalPath="/waitlist"
      locale={locale}
    >
      <WaitlistCard precheck={auth.waitlistPrecheck} />
    </AuthShell>
  );
}
