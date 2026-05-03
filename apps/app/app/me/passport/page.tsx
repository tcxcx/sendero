/**
 * `/me/passport` — declared traveler signals + uploaded passport status.
 *
 * Reads `User.metadata.travelerProfile` (T1 declared signals) via the
 * same helpers `/api/traveler/profile` uses. Encrypted PassportVault
 * (T2) status is shown as a presence indicator only — the route never
 * exposes the encrypted record body.
 */

import { auth } from '@clerk/nextjs/server';

import { prisma } from '@sendero/database';
import { readDeclaredTravelerSignals } from '@sendero/vault';

import {
  EmptyStateCard,
  Stat,
  StatGrid,
  TravelerSurface,
  TravelerSurfaceHeader,
} from '@/components/traveler/traveler-surface';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function TravelerPassportPage() {
  const { userId } = await auth();
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { clerkUserId: userId },
    select: { id: true, passportVaults: { select: { id: true }, take: 1 } },
  });
  if (!user) return null;

  const declared = await readDeclaredTravelerSignals(prisma, user.id);
  const hasVault = user.passportVaults.length > 0;
  const expiresOn = declared
    ? declared.declaredPassportExpiry.toISOString().slice(0, 10)
    : null;
  const monthsUntilExpiry = declared
    ? Math.max(
        0,
        Math.floor(
          (declared.declaredPassportExpiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30)
        )
      )
    : null;

  return (
    <TravelerSurface>
      <TravelerSurfaceHeader
        title="Your passport"
        subhead="Declared signals power eligibility checks at search time; the encrypted vault enables one-tap passenger creation on Duffel without re-asking each trip."
      />

      <StatGrid>
        <Stat label="Nationality" value={declared?.declaredNationalityIso3 ?? '—'} />
        <Stat label="Expiry" value={expiresOn ?? '—'} />
        <Stat
          label="Months left"
          value={monthsUntilExpiry !== null ? String(monthsUntilExpiry) : '—'}
        />
        <Stat label="Encrypted vault" value={hasVault ? 'Stored' : 'Empty'} />
      </StatGrid>

      {!declared && !hasVault ? (
        <EmptyStateCard
          title="Passport not on file."
          body="Book a trip via WhatsApp or web and the agent collects your details once — they're stored encrypted at rest and reused for every future booking."
        />
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-xl">Stored details</h2>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            <li className="flex items-center justify-between px-4 py-3">
              <p className="text-sm">Declared nationality (ISO 3166-1 alpha-3)</p>
              <p className="font-mono text-xs text-muted-foreground">
                {declared?.declaredNationalityIso3 ?? '—'}
              </p>
            </li>
            <li className="flex items-center justify-between px-4 py-3">
              <p className="text-sm">Declared passport expiry</p>
              <p className="font-mono text-xs text-muted-foreground">{expiresOn ?? '—'}</p>
            </li>
            <li className="flex items-center justify-between px-4 py-3">
              <p className="text-sm">Encrypted vault record</p>
              <p className="font-mono text-xs text-muted-foreground">
                {hasVault ? 'present' : 'not uploaded'}
              </p>
            </li>
          </ul>
          <p className="text-xs text-muted-foreground">
            The encrypted record powers eligibility checks and Duffel passenger creation without
            re-asking each trip. Updates happen during booking.
          </p>
        </section>
      )}
    </TravelerSurface>
  );
}
