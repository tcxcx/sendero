-- Trip.guestVerifiedContacts — first-class column for the verified
-- contact channels a buyer attached to a trip at prefund time.
--
-- Shape: { phone?: string, email?: string }
--   - phone : E.164, verified at trip creation (SMS / WhatsApp opt-in)
--   - email : RFC-5322, verified at trip creation
--
-- Read by `apps/app/app/api/trip/[tripId]/claim-code/resend/route.ts`
-- to gate guest-driven OTP resends. Until this column existed, the
-- resend route fell back to `Trip.metadata.invite.guestEmail` set in
-- `apps/app/app/api/guest/invite/route.ts`. The fallback path is kept
-- in code for backward compat with rows created before this migration.
--
-- Nullable on purpose:
--   - Trips created before markup v1 don't have verified contacts.
--   - Agent-created trips (no buyer-driven prefund) won't either.
-- Backfill for legacy rows lives in a follow-up migration once the
-- guest-invite UI starts populating this column at write time.

ALTER TABLE "trips" ADD COLUMN "guestVerifiedContacts" JSONB;
