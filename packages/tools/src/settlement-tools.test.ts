import { test, expect } from 'bun:test';

import { cancelBookingTool } from './cancel-booking';
import { confirmFlightTool } from './confirm-flight';
import { settleBookingTool } from './settle-booking';

const BID = `0x${'1'.repeat(64)}`;
const TID = `0x${'2'.repeat(64)}`;
const HASH = `0x${'3'.repeat(64)}`;
const ESCROW = `0x${'a'.repeat(40)}`;

test('confirm_flight returns an encoded call', async () => {
  const out: any = await confirmFlightTool.handler({
    bookingId: BID,
    // Field renamed from `duffelOrderHash` → `ticketOrderHash` in
    // commit cd6ff4a as part of the Duffel→flight supplier abstraction.
    ticketOrderHash: HASH,
    escrowAddress: ESCROW,
  });
  expect(out.onchainCall.to.toLowerCase()).toBe(ESCROW.toLowerCase());
  expect(out.onchainCall.data.startsWith('0x')).toBe(true);
  expect(out.onchainCall.value).toBe('0');
});

test('settle_booking returns an encoded call', async () => {
  const out: any = await settleBookingTool.handler({ bookingId: BID, escrowAddress: ESCROW });
  expect(out.onchainCall.to.toLowerCase()).toBe(ESCROW.toLowerCase());
  expect(out.onchainCall.data.startsWith('0x')).toBe(true);
});

test('cancel_booking emits refundBooking + sweepUnspent in order', async () => {
  const out: any = await cancelBookingTool.handler({
    bookingId: BID,
    tripId: TID,
    reason: 'duffel_failed',
    escrowAddress: ESCROW,
  });
  expect(out.onchainCalls.length).toBe(2);
  expect(out.onchainCalls[0].to.toLowerCase()).toBe(ESCROW.toLowerCase());
  expect(out.onchainCalls[1].to.toLowerCase()).toBe(ESCROW.toLowerCase());
  // Distinct function selectors → distinct first 10 chars of calldata.
  expect(out.onchainCalls[0].data.slice(0, 10)).not.toBe(out.onchainCalls[1].data.slice(0, 10));
});

test('settle_booking rejects bad bookingId', async () => {
  await expect(
    settleBookingTool.handler({ bookingId: '0xnot-hex', escrowAddress: ESCROW })
  ).rejects.toThrow();
});
