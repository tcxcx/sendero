-- Payer model: who provisioned the spend on a trip.
-- 'tenant'    = pre-paid budget / corporate TMC pays.
-- 'traveler'  = direct purchase / consumer pays.
-- 'split'     = reserved; mixed-payer flows. Tools must reject 'split' until
--               per-tool provisionedBy resolution lands (see Trip.paymentMode
--               handling in resolvePayer).
CREATE TYPE "TripPaymentMode" AS ENUM ('tenant', 'traveler', 'split');

CREATE TYPE "MeterPayerType" AS ENUM ('tenant', 'traveler');
