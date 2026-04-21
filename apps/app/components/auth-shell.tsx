import Link from 'next/link';
import type { ReactNode } from 'react';

type AuthShellProps = {
  title: string;
  description: string;
  asideTitle: string;
  asideItems: string[];
  children: ReactNode;
};

export function AuthShell({
  title,
  description,
  asideTitle,
  asideItems,
  children,
}: AuthShellProps) {
  return (
    <main className="grid min-h-screen bg-[var(--bg)] text-[var(--text)] lg:grid-cols-[minmax(360px,0.92fr)_minmax(420px,1.08fr)]">
      <section className="flex flex-col justify-between border-b border-[var(--border)] px-5 py-6 sm:px-8 lg:min-h-screen lg:border-b-0 lg:border-r">
        <Link href="/" className="flex items-center gap-3 no-underline">
          <span className="size-3 bg-[var(--ink)]" aria-hidden="true" />
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--text)]">
            Sendero
          </span>
        </Link>

        <div className="max-w-xl py-12 lg:py-0">
          <div className="mb-5 inline-flex border border-[var(--border)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-dim)]">
            {asideTitle}
          </div>
          <h1 className="m-0 text-[36px] font-medium leading-none tracking-normal sm:text-[48px] lg:text-[60px]">
            {title}
          </h1>
          <p className="mt-5 max-w-md text-base leading-7 text-[var(--text-dim)]">{description}</p>
        </div>

        <div className="grid gap-3">
          {asideItems.map(item => (
            <div
              className="border border-[var(--border)] bg-[var(--bg-elev)] px-4 py-3 text-sm leading-6 text-[var(--text-dim)]"
              key={item}
            >
              {item}
            </div>
          ))}
        </div>
      </section>

      <section className="flex items-center justify-center px-5 py-8 sm:px-8 lg:min-h-screen lg:py-10">
        <div className="w-full max-w-md">{children}</div>
      </section>
    </main>
  );
}
