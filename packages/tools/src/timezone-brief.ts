import { z } from 'zod';

import { parseJsonOrThrow, requireGoogleMapsApiKey } from './google-travel-shared';
import type { ToolDef } from './types';

const inputSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  timestamp: z.number().int().optional().describe('Unix seconds. Defaults to now.'),
  language: z.string().optional(),
});

export type TimezoneBriefInput = z.infer<typeof inputSchema>;

export interface TimezoneBriefResult {
  timeZoneId?: string;
  timeZoneName?: string;
  rawOffsetSeconds?: number;
  dstOffsetSeconds?: number;
  localTimeIso?: string;
}

interface RawTimeZoneResponse {
  timeZoneId?: string;
  timeZoneName?: string;
  rawOffset?: number;
  dstOffset?: number;
  status?: string;
}

export async function timezoneBrief(input: TimezoneBriefInput): Promise<TimezoneBriefResult> {
  const apiKey = requireGoogleMapsApiKey('timezone_brief');
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
  const params = new URLSearchParams({
    key: apiKey,
    location: `${input.latitude},${input.longitude}`,
    timestamp: String(timestamp),
  });
  if (input.language) params.set('language', input.language);

  const response = await fetch(`https://maps.googleapis.com/maps/api/timezone/json?${params}`);
  const data = (await parseJsonOrThrow(response, 'Google Time Zone API')) as RawTimeZoneResponse;

  const totalOffset = (data.rawOffset ?? 0) + (data.dstOffset ?? 0);
  return {
    timeZoneId: data.timeZoneId,
    timeZoneName: data.timeZoneName,
    rawOffsetSeconds: data.rawOffset,
    dstOffsetSeconds: data.dstOffset,
    localTimeIso: new Date((timestamp + totalOffset) * 1000).toISOString(),
  };
}

export const timezoneBriefTool: ToolDef<TimezoneBriefInput, TimezoneBriefResult> = {
  name: 'timezone_brief',
  description:
    'Return time zone and local-time context for a location. Use for arrival planning, meeting safety, and transfer timing.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['latitude', 'longitude'],
    properties: {
      latitude: { type: 'number' },
      longitude: { type: 'number' },
      timestamp: { type: 'integer', description: 'Unix seconds. Defaults to now.' },
      language: { type: 'string' },
    },
  },
  handler: timezoneBrief,
};
