import { expect, test, mock, beforeEach } from 'bun:test';

type Call = { op: string; args: unknown };
const calls: Call[] = [];
let createResult: unknown = null;
let updateResult: unknown = null;

mock.module('@sendero/database', () => ({
  prisma: {
    arrivalPlaybookRun: {
      create: async (args: unknown) => {
        calls.push({ op: 'create', args });
        return createResult;
      },
      update: async (args: unknown) => {
        calls.push({ op: 'update', args });
        return updateResult;
      },
    },
  },
}));

const { recordArrivalPlaybook, markPlaybookActioned } = await import('./arrival-sync');

beforeEach(() => {
  calls.length = 0;
  createResult = { id: 'apl_1' };
  updateResult = { id: 'apl_1' };
});

test('recordArrivalPlaybook normalizes airportIata to uppercase and defaults restaurantIds to []', async () => {
  await recordArrivalPlaybook({
    tenantId: 'tnt_1',
    tripId: 'trp_1',
    airportIata: 'jfk',
    playbook: { bullets: ['a', 'b'] },
    workflowRunId: 'wrf_1',
  });
  const data = (calls[0]?.args as { data: Record<string, unknown> }).data;
  expect(data.airportIata).toBe('JFK');
  expect(data.restaurantIds).toEqual([]);
  expect(data.playbook).toEqual({ bullets: ['a', 'b'] });
  expect(data.workflowRunId).toBe('wrf_1');
});

test('recordArrivalPlaybook passes through restaurantIds and routeMapCid', async () => {
  await recordArrivalPlaybook({
    tenantId: 'tnt_1',
    tripId: 'trp_1',
    airportIata: 'SFO',
    restaurantIds: ['rst_1', 'rst_2'],
    routeMapCid: 'bafy123',
    playbook: { ok: true },
  });
  const data = (calls[0]?.args as { data: Record<string, unknown> }).data;
  expect(data.restaurantIds).toEqual(['rst_1', 'rst_2']);
  expect(data.routeMapCid).toBe('bafy123');
});

test('recordArrivalPlaybook rejects non-3-char airportIata', async () => {
  await expect(
    recordArrivalPlaybook({
      tenantId: 'tnt_1',
      tripId: 'trp_1',
      airportIata: 'JFKX',
      playbook: {},
    })
  ).rejects.toThrow(/3 chars/);
});

test('markPlaybookActioned sets actionedAt', async () => {
  await markPlaybookActioned({ id: 'apl_1' });
  const data = (calls[0]?.args as { data: { actionedAt: Date } }).data;
  expect(data.actionedAt).toBeInstanceOf(Date);
});
