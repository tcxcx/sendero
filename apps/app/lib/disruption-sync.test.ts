import { expect, test, mock, beforeEach } from 'bun:test';

type Call = { op: string; args: unknown };
const calls: Call[] = [];
const state: {
  findUniqueResult: { resolution: Record<string, unknown> | null } | null;
  createResult: unknown;
  updateResult: unknown;
} = {
  findUniqueResult: null,
  createResult: null,
  updateResult: null,
};

mock.module('@sendero/database', () => ({
  prisma: {
    disruptionRun: {
      create: async (args: unknown) => {
        calls.push({ op: 'create', args });
        return state.createResult;
      },
      findUnique: async (args: unknown) => {
        calls.push({ op: 'findUnique', args });
        return state.findUniqueResult;
      },
      update: async (args: unknown) => {
        calls.push({ op: 'update', args });
        return state.updateResult;
      },
    },
  },
}));

const { openDisruptionRun, updateDisruptionStatus } = await import('./disruption-sync');

beforeEach(() => {
  calls.length = 0;
  state.findUniqueResult = null;
  state.createResult = { id: 'dr_1', status: 'open' };
  state.updateResult = { id: 'dr_1', status: 'resolved' };
});

test('openDisruptionRun creates with status=open', async () => {
  await openDisruptionRun({
    tenantId: 'tnt_1',
    tripId: 'trp_1',
    bookingId: 'bkg_1',
    kind: 'delay',
    source: 'webhook',
    workflowRunId: 'wrf_1',
  });
  const c = calls[0];
  expect(c?.op).toBe('create');
  const data = (c?.args as { data: Record<string, unknown> }).data;
  expect(data.status).toBe('open');
  expect(data.kind).toBe('delay');
  expect(data.source).toBe('webhook');
  expect(data.workflowRunId).toBe('wrf_1');
});

test('updateDisruptionStatus merges resolution JSON and sets resolvedAt on terminal status', async () => {
  state.findUniqueResult = { resolution: { choice: 'rebook', priorKey: 1 } };
  await updateDisruptionStatus({
    id: 'dr_1',
    status: 'resolved',
    resolution: { fareDeltaUsd: 42 },
  });
  const update = calls.find(c => c.op === 'update');
  expect(update).toBeDefined();
  const data = (update?.args as { data: Record<string, unknown> }).data;
  expect(data.status).toBe('resolved');
  expect(data.resolution).toEqual({ choice: 'rebook', priorKey: 1, fareDeltaUsd: 42 });
  expect(data.resolvedAt).toBeInstanceOf(Date);
});

test('updateDisruptionStatus does not set resolvedAt on non-terminal status', async () => {
  state.findUniqueResult = { resolution: null };
  await updateDisruptionStatus({ id: 'dr_1', status: 'rebooking' });
  const update = calls.find(c => c.op === 'update');
  const data = (update?.args as { data: Record<string, unknown> }).data;
  expect(data.status).toBe('rebooking');
  expect('resolvedAt' in data).toBe(false);
  expect('resolution' in data).toBe(false);
});

test('updateDisruptionStatus throws when run id not found', async () => {
  state.findUniqueResult = null;
  await expect(updateDisruptionStatus({ id: 'dr_missing', status: 'resolved' })).rejects.toThrow(
    /not found/
  );
});
