import { z } from 'zod';
import type { ToolDef } from './types';

/**
 * Post-trip reputation rating for an agent (ERC-8004). In production
 * this would sign a validator attestation and write to the ERC-8004
 * reputation registry on Arc. The hackathon version records the
 * rating in-memory and returns a stub tx reference so the demo loop
 * can show rating events streaming through the meter.
 *
 * Priced cheap because it's called once per booking — many bookings
 * per demo run.
 */

export interface AgentRating {
  agentId: string;
  raterId?: string;
  stars: number;
  bookingRef?: string;
  note?: string;
  at: number;
}

const _ratings: AgentRating[] = [];

export function getAgentRatings(agentId?: string): AgentRating[] {
  return agentId ? _ratings.filter((r) => r.agentId === agentId) : _ratings.slice();
}

export function summarizeAgent(agentId: string): {
  agentId: string;
  avgStars: number;
  count: number;
} {
  const rs = getAgentRatings(agentId);
  if (!rs.length) return { agentId, avgStars: 0, count: 0 };
  const sum = rs.reduce((a, r) => a + r.stars, 0);
  return {
    agentId,
    avgStars: Number((sum / rs.length).toFixed(2)),
    count: rs.length,
  };
}

const inputSchema = z.object({
  agentId: z
    .string()
    .describe('ERC-8004 agent identifier (e.g. "2286" for the Sendero agent NFT).'),
  stars: z.number().min(1).max(5).describe('1-5 rating.'),
  bookingRef: z.string().optional().describe('Optional PNR or job ID.'),
  note: z.string().optional(),
});

export const rateAgentTool: ToolDef = {
  name: 'rate_agent',
  description:
    'Record a post-booking rating for a Sendero agent (writes to ERC-8004 reputation in production). Returns the updated avg score + count.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['agentId', 'stars'],
    properties: {
      agentId: { type: 'string' },
      stars: { type: 'integer', minimum: 1, maximum: 5 },
      bookingRef: { type: 'string' },
      note: { type: 'string' },
    },
  },
  async handler(input: any) {
    const rating: AgentRating = {
      agentId: String(input.agentId),
      stars: Number(input.stars),
      bookingRef: input.bookingRef,
      note: input.note,
      at: Date.now(),
    };
    _ratings.push(rating);
    const summary = summarizeAgent(rating.agentId);
    return {
      recorded: true,
      rating,
      summary,
      // Mock on-chain ref (real ERC-8004 write is a separate step).
      attestationRef: `stub-${Date.now().toString(36)}`,
    };
  },
};
