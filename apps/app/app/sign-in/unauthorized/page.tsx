import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthShell } from '@/components/auth-shell';
import { getAuthCopy } from '@/lib/auth-copy';
import { getRequestLocale } from '@/lib/request-locale';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const copy = getAuthCopy(locale).unauthorizedSignIn;
  return {
    title: `${copy.title} · Sendero`,
    description: copy.description,
  };
}

export default async function UnauthorizedSignInPage() {
  const locale = await getRequestLocale();
  const copy = getAuthCopy(locale).unauthorizedSignIn;

  return (
    <AuthShell
      title={copy.title}
      description={copy.description}
      asideTitle={copy.asideTitle}
      asideItems={copy.asideItems}
      canonicalPath="/sign-in/unauthorized"
      locale={locale}
    >
      <div className="flex flex-col gap-5">
        <Link
          href="/sign-in"
          className="s-press inline-flex h-11 items-center justify-center border border-[var(--ink)] bg-[var(--ink)] px-4 font-mono text-[11px] uppercase tracking-[0.12em] text-white no-underline transition-colors hover:bg-[var(--ink)]/90"
        >
          {copy.ctaSignIn}
        </Link>
        <p className="m-0 text-center font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
          Sendero · Clerk security
        </p>
      </div>
    </AuthShell>
  );
}
