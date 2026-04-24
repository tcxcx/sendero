import { expect, test, mock, beforeEach } from 'bun:test';

type Call = { op: string; args: unknown };
const calls: Call[] = [];
let createResult: unknown = null;

mock.module('@sendero/database', () => ({
  prisma: {
    supportTurn: {
      create: async (args: unknown) => {
        calls.push({ op: 'create', args });
        return createResult;
      },
    },
  },
}));

const { recordSupportTurn } = await import('./support-sync');

beforeEach(() => {
  calls.length = 0;
  createResult = { id: 'sup_1' };
});

test('recordSupportTurn creates a plain row (append-only)', async () => {
  await recordSupportTurn({
    tenantId: 'tnt_1',
    userId: 'usr_1',
    tripId: 'trp_1',
    turnSummary: 'Traveler asked about seat change',
    outcome: 'answered',
    nanopayEventId: 'me_1',
    rawIo: { foo: 'bar' },
  });
  expect(calls.length).toBe(1);
  const data = (calls[0]?.args as { data: Record<string, unknown> }).data;
  expect(data.tenantId).toBe('tnt_1');
  expect(data.outcome).toBe('answered');
  expect(data.turnSummary).toBe('Traveler asked about seat change');
  expect(data.rawIo).toEqual({ foo: 'bar' });
});

test('recordSupportTurn rejects empty turnSummary', async () => {
  await expect(
    recordSupportTurn({
      tenantId: 'tnt_1',
      turnSummary: '   ',
      outcome: 'answered',
    })
  ).rejects.toThrow(/turnSummary/);
});
