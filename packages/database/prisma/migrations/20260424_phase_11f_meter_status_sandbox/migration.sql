-- Add 'sandbox' value to MeterStatus enum. Rows with this status are
-- recorded for analytics but excluded from NanopayBatch settlement.
-- Used by API-key-authenticated calls from sandbox keys and by
-- production keys downgraded during testnet-beta network mode.
ALTER TYPE "MeterStatus" ADD VALUE 'sandbox';
