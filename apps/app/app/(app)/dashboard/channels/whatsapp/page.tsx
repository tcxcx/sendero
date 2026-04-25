import Link from 'next/link';
import { revalidatePath } from 'next/cache';

import { prisma } from '@sendero/database';
import { env } from '@sendero/env';
import { KapsoClient } from '@sendero/kapso';

import {
  ChannelStatusPanel,
  type ChannelStatusKind,
} from '@/components/channels/channel-status-panel';
import { WhatsappConnectedPanel } from '@/components/channels/whatsapp-connected-panel';
import { requireCurrentTenant } from '@/lib/tenant-context';

export default async function WhatsAppChannelPage() {
  const { tenant } = await requireCurrentTenant();

  const install = await prisma.whatsAppInstall.findUnique({
    where: { tenantId: tenant.id },
    select: {
      status: true,
      displayPhoneNumber: true,
      businessDisplayName: true,
      lastHealthyAt: true,
      lastErrorMessage: true,
      phoneNumberId: true,
      metadata: true,
    },
  });

  const status: ChannelStatusKind = install
    ? (install.status as ChannelStatusKind)
    : 'not_installed';
  const identifier = install?.displayPhoneNumber
    ? install.businessDisplayName
      ? `${install.businessDisplayName} · ${install.displayPhoneNumber}`
      : install.displayPhoneNumber
    : null;

  async function probe() {
    'use server';
    const { tenant: t } = await requireCurrentTenant();
    const row = await prisma.whatsAppInstall.findUnique({
      where: { tenantId: t.id },
      select: { id: true, phoneNumberId: true },
    });
    if (!row?.phoneNumberId) return { ok: false, message: 'No phone_number_id on install' };
    const apiKey = env.kapsoApiKey();
    if (!apiKey) return { ok: false, message: 'KAPSO_API_KEY missing in this environment' };
    try {
      const kapso = new KapsoClient({ apiKey, baseUrl: env.kapsoApiBaseUrl() });
      await kapso.getPhoneNumber(row.phoneNumberId);
      await prisma.whatsAppInstall.update({
        where: { id: row.id },
        data: { status: 'active', lastErrorMessage: null, lastHealthyAt: new Date() },
      });
      revalidatePath('/dashboard/channels/whatsapp');
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.whatsAppInstall.update({
        where: { id: row.id },
        data: { status: 'error', lastErrorMessage: message },
      });
      revalidatePath('/dashboard/channels/whatsapp');
      return { ok: false, message };
    }
  }

  if (status === 'active' && install) {
    const metadata = (install.metadata as Record<string, unknown> | null) ?? {};
    const templates = Array.isArray(metadata.templates)
      ? (metadata.templates as Array<{ name: string; status: string }>)
      : [];
    return (
      <div className="flex max-w-5xl flex-col gap-6">
        <WhatsappConnectedPanel
          displayName={install.businessDisplayName}
          displayPhoneNumber={install.displayPhoneNumber}
          status="Connected"
          templates={templates}
          recentThreads={[]}
          weeklyStats={{ trips: 0, messages: 0, deliveryRate: 100 }}
        />
        <section className="flex flex-col gap-2 rounded-[var(--radius-lg)] bg-[color:var(--surface-raised)] p-6 shadow-[var(--shadow-sm)]">
          <h3 className="text-[15px] font-semibold tracking-normal text-foreground">
            What this does
          </h3>
          <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
            <li>
              <strong className="text-foreground">Inbound</strong>: Travelers message your WhatsApp
              number; the agent surfaces threads in{' '}
              <Link className="underline underline-offset-2" href="/dashboard/inbox">
                Trip inboxes
              </Link>
              .
            </li>
            <li>
              <strong className="text-foreground">Outbound</strong>: Operators reply from the trip
              composer; sends route through Kapso.
            </li>
          </ul>
        </section>
      </div>
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <ChannelStatusPanel
        brand="whatsapp"
        status={status}
        identifier={identifier}
        lastHealthyAt={install?.lastHealthyAt?.toISOString() ?? null}
        lastErrorMessage={install?.lastErrorMessage ?? null}
        connectHref="/dashboard/channels/whatsapp/connect"
        onProbe={status === 'not_installed' ? undefined : probe}
      />
      <section className="flex flex-col gap-2 rounded-[var(--radius-lg)] bg-[color:var(--surface-raised)] p-6 shadow-[var(--shadow-sm)]">
        <h3 className="text-[15px] font-semibold tracking-normal text-foreground">
          Set up the channel
        </h3>
        <p className="text-sm text-muted-foreground">
          The 5-step wizard takes about 5 minutes. Sendero owns the WhatsApp Business Account, so
          there&rsquo;s no Meta embedded signup — you pick a number from our pool and brand the
          experience.
        </p>
        <Link
          href="/dashboard/channels/whatsapp/connect"
          className="mt-2 inline-flex w-fit rounded-md bg-[color:var(--accent-rose)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-white transition-opacity hover:opacity-90"
        >
          Start setup
        </Link>
      </section>
    </div>
  );
}
