/**
 * Universal eSIM install page — `/install/esim/[token]`.
 *
 * One URL. One QR. Per-device dispatch:
 *
 *   iOS Safari (17.4+) → server detects iOS UA, returns a tiny page that
 *     `window.location.href = lpaCode` on mount. iOS opens Cellular →
 *     Add eSIM directly. This is the "tap to install" path that makes
 *     the WhatsApp `cta_url` button work end-to-end.
 *
 *   Android / desktop / older iOS → render the QR + per-device tabs.
 *     Android users scan the QR from another device, OR copy the LPA
 *     activation code as a manual fallback.
 *
 * Token: HMAC-signed `<base64url(esimId)>.<sig>`. Same shape as the
 * `/api/esim/qr/<token>.png` endpoint — both are issued by
 * `signQrToken()` in `@sendero/esim/qr`.
 */

import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { prisma } from '@sendero/database';
import { verifyQrToken } from '@sendero/esim';

import {
  detectDeviceFromUA,
  INSTALL_INSTRUCTIONS,
  DEVICE_ORDER,
} from '@/lib/channel-render/install-instructions';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function EsimInstallPage({ params }: PageProps) {
  const secret = process.env.INVOICE_SIGNING_SECRET ?? '';
  if (!secret) notFound();

  const { token } = await params;
  const verified = verifyQrToken(token, secret);
  if (!verified) notFound();

  const esim = await prisma.esim.findUnique({
    where: { id: verified.esimId },
    select: {
      id: true,
      lpaCode: true,
      activationCode: true,
      destinationCountries: true,
      dataMb: true,
      validityDays: true,
      expiresAt: true,
      status: true,
    },
  });
  if (!esim) notFound();
  if (esim.status === 'expired') {
    return <ExpiredScreen />;
  }

  const headerList = await headers();
  const ua = headerList.get('user-agent');
  const device = detectDeviceFromUA(ua);

  const qrUrl = `/api/esim/qr/${encodeURIComponent(token)}.png`;
  const countries = (esim.destinationCountries as string[] | null) ?? [];
  const planLabel = `${(esim.dataMb / 1024).toFixed(1)} GB · ${esim.validityDays} days · ${countries.join(', ')}`;

  // iOS auto-redirect snippet. Inline script — keeps the round-trip
  // tight (no client component hydration delay before the iOS prompt
  // pops). Browsers without LPA: handler error out silently and the
  // user falls through to the QR.
  const iosAutoRedirect = device === 'ios';

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-1">
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          Trip eSIM
        </div>
        <h1 className="text-xl font-medium text-foreground">{planLabel}</h1>
      </header>

      {iosAutoRedirect ? (
        <>
          <script
            dangerouslySetInnerHTML={{
              __html: `setTimeout(function(){ window.location.href = ${JSON.stringify(esim.lpaCode)}; }, 600);`,
            }}
          />
          <p className="rounded-md border border-border bg-card p-3 text-sm">
            Opening Cellular Settings… If nothing happens,{' '}
            <a className="font-medium underline" href={esim.lpaCode}>
              tap here
            </a>
            .
          </p>
        </>
      ) : null}

      <section className="flex flex-col items-center gap-3 rounded-md border border-border bg-card p-4">
        <img
          src={qrUrl}
          alt={`Install QR for ${planLabel}`}
          width={280}
          height={280}
          className="h-72 w-72 rounded-sm border border-border bg-white object-contain p-2"
        />
        <p className="text-center text-xs text-muted-foreground">
          Scan with the device you'll travel with — or tap the button on iPhone.
        </p>
        <a
          href={esim.lpaCode}
          className="rounded-sm border border-[color:var(--ink)] bg-[color:var(--ink)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--bg-elev)] transition-opacity hover:opacity-90"
        >
          📱 Install on iPhone
        </a>
      </section>

      <section id="instructions" className="flex flex-col gap-4">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          Per-device instructions
        </h2>
        {DEVICE_ORDER.map(d => {
          const i = INSTALL_INSTRUCTIONS[d];
          const highlighted = d === device;
          return (
            <details
              key={d}
              open={highlighted}
              className={`rounded-md border bg-card p-3 ${highlighted ? 'border-[color:var(--ink)]' : 'border-border'}`}
            >
              <summary className="cursor-pointer text-sm font-medium text-foreground">
                {i.label}
                {i.subLabel ? (
                  <span className="ml-1 text-muted-foreground">· {i.subLabel}</span>
                ) : null}
                {i.oneTap ? (
                  <span className="ml-2 rounded-sm border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                    one-tap
                  </span>
                ) : null}
              </summary>
              <ol className="ml-5 mt-2 list-decimal space-y-1 text-sm text-muted-foreground">
                {i.steps.map((s, idx) => (
                  <li key={idx}>{s}</li>
                ))}
              </ol>
              {i.showLpaCode ? (
                <div className="mt-2 rounded-sm border border-border bg-background/50 p-2 font-mono text-[10px] text-muted-foreground">
                  <div className="uppercase tracking-[0.1em]">Activation code</div>
                  <div className="select-all break-all">{esim.lpaCode}</div>
                </div>
              ) : null}
            </details>
          );
        })}
      </section>

      <footer className="text-center text-[11px] text-muted-foreground">
        eSIM ID {esim.id}
        {esim.expiresAt ? ` · expires ${esim.expiresAt.toISOString().slice(0, 10)}` : ''}
      </footer>
    </main>
  );
}

function ExpiredScreen() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4">
      <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        Trip eSIM
      </div>
      <h1 className="text-xl font-medium text-foreground">This eSIM has expired</h1>
      <p className="text-center text-sm text-muted-foreground">
        Plans expire after the validity window ends. Ask the agent to provision a new one.
      </p>
    </main>
  );
}
