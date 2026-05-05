-- Phase A.4: airline-issued e-ticket persistence on Booking.
--
-- After Duffel returns `status: 'ticketed'`, the carrier's reservation
-- system mints a real e-ticket PDF accessible via Duffel's
-- `GET /air/orders/{id}/documents`. Sendero fetches and persists it
-- here so the post-ticketing fan-out can attach it to the BOOKING_
-- CONFIRMED email and ship it via WhatsApp `send_document_message`.
-- Without this, travelers walked into airport check-in counters with
-- only the PNR — fine for code-share carriers that support PNR-only
-- retrieval, broken for everyone else.

ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "eTicketDocumentUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "eTicketIssuedAt"    TIMESTAMPTZ(6);
