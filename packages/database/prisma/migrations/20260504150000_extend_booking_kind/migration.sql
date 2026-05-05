-- Extend BookingKind to cover eSIM bookings + card-issuance fees so the
-- existing TenantPricingPolicy + senderoTakeMicro machinery serves these
-- surfaces without a parallel pricing config.
--
-- Each ADD VALUE is its own statement; Prisma migrate deploy runs the
-- file outside a transaction (see CLAUDE.md "Pre-commit migration lint")
-- so non-tx ALTER TYPE is safe. No same-file references to the new
-- values — all consumers (MarkupConfigSchema in @sendero/billing/markup,
-- BOOKING_KINDS const, UI defaults) land in the application layer in the
-- subsequent commit, not in this migration.

ALTER TYPE "BookingKind" ADD VALUE IF NOT EXISTS 'esim';
ALTER TYPE "BookingKind" ADD VALUE IF NOT EXISTS 'card';
