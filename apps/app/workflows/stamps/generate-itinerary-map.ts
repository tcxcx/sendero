/**
 * ItineraryMap is special: it can be re-generated as new flight legs
 * are added. The first run mints; subsequent runs detect the
 * pre-existing NftStamp row inside `mint_stamp` (cached path) and
 * we'd ordinarily skip the on-chain refresh.
 *
 * For now this entrypoint only handles the first mint. The
 * `refresh_stamp_uri` tool exists for the refresh path and will be
 * wired into a sibling workflow `refreshItineraryMap` once we settle
 * on the trigger (every new leg vs. trip-status transition).
 */

import { generateStamp } from './generate-stamp';

export const generateItineraryMap = async (args: { tripId: string }) => {
  'use workflow';
  return generateStamp({ kind: 'ItineraryMap', tripId: args.tripId, bookingId: null });
};
