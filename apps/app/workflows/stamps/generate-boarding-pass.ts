import { generateStamp } from './generate-stamp';

export const generateBoardingPass = async (args: { tripId: string; bookingId: string }) => {
  'use workflow';
  return generateStamp({ kind: 'BoardingPass', tripId: args.tripId, bookingId: args.bookingId });
};
