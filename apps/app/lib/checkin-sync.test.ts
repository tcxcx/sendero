import { expect, test, mock, beforeEach } from 'bun:test';

type Call = { op: string; args: unknown };
const calls: Call[] = [];
const state: {
  findFirstResult: unknown;
  createResult: unknown;
  updateResult: unknown;
} = {
  findFirstResult: null,
  createResult: null,
  updateResult: null,
};

mock.module('@sendero/database', () => ({
  prisma: {
    checkInNudge: {
      findFirst: async (args: unknown) => {
        calls.push({ op: 'findFirst', args });
        return state.findFirstResult;
      },
      create: async (args: unknown) => {
        calls.push({ op: 'create', args });
        return state.createResult;
      },
      update: async (args: unknown) => {
        calls.push({ op: 'update', args });
        return state.updateResult;
      },
    },
  },
}));

const { scheduleCheckInNudge, markNudgeFired, markNudgeActioned } = await import('./checkin-sync');

beforeEach(() => {
  calls.length = 0;
  state.findFirstResult = null;
  state.createResult = { id: 'cin_1' };
  state.updateResult = { id: 'cin_1' };
});

test('scheduleCheckInNudge creates a row when none exists at (tripId, scheduledAt)', async () => {
  const scheduledAt = new Date('2026-05-01T09:00:00Z');
  await scheduleCheckInNudge({
    tenantId: 'tnt_1',
    tripId: 'trp_1',
    scheduledAt,
    channel: 'whatsapp',
    leaveByIso: '2026-05-01T08:30:00Z',
    metadata: { gate: 'A4' },
  });
  expect(calls[0]?.op).toBe('findFirst');
  const find = calls[0]?.args as { where: { tripId: string; scheduledAt: Date } };
  expect(find.where.tripId).toBe('trp_1');
  expect(find.where.scheduledAt).toBe(scheduledAt);

  expect(calls[1]?.op).toBe('create');
  const data = (calls[1]?.args as { data: Record<string, unknown> }).data;
  expect(data.channel).toBe('whatsapp');
  expect(data.metadata).toEqual({ gate: 'A4' });
});

test('scheduleCheckInNudge is idempotent — returns existing row without creating', async () => {
  state.findFirstResult = { id: 'cin_existing', tripId: 'trp_1' };
  const result = await scheduleCheckInNudge({
    tenantId: 'tnt_1',
    tripId: 'trp_1',
    scheduledAt: new Date('2026-05-01T09:00:00Z'),
    channel: 'slack',
  });
  expect(result).toEqual({ id: 'cin_existing', tripId: 'trp_1' });
  expect(calls.some(c => c.op === 'create')).toBe(false);
});

test('markNudgeFired defaults firedAt to now()', async () => {
  const before = Date.now();
  await markNudgeFired({ id: 'cin_1' });
  const after = Date.now();
  const data = (calls[0]?.args as { data: { firedAt: Date } }).data;
  expect(data.firedAt).toBeInstanceOf(Date);
  expect(data.firedAt.getTime()).toBeGreaterThanOrEqual(before);
  expect(data.firedAt.getTime()).toBeLessThanOrEqual(after);
});

test('markNudgeActioned sets actionedAt', async () => {
  await markNudgeActioned({ id: 'cin_1' });
  const data = (calls[0]?.args as { data: { actionedAt: Date } }).data;
  expect(data.actionedAt).toBeInstanceOf(Date);
});
