/**
 * TripPassport is the "completed-trip" capstone NFT. Same single class
 * id is minted once with auto-assign, then extended (one unit per
 * additional traveler DCW) by `execMintExtend` inside the generic
 * generator. Today Trip has a single travelerId so we'll usually mint
 * one unit, but the loop is in place for the multi-traveler upgrade.
 */

import { generateStamp } from './generate-stamp';

export const generateTripPassport = async (args: { tripId: string }) => {
  'use workflow';
  return generateStamp({ kind: 'TripPassport', tripId: args.tripId, bookingId: null });
};
