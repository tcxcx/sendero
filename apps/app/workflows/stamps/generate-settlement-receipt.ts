import { generateStamp } from './generate-stamp';

export const generateSettlementReceipt = async (args: { tripId: string; bookingId: string }) => {
  'use workflow';
  return generateStamp({
    kind: 'SettlementReceipt',
    tripId: args.tripId,
    bookingId: args.bookingId,
  });
};
