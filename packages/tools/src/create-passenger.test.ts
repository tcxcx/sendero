import { beforeEach, describe, expect, mock, test } from 'bun:test';

const findSlackInstall = mock(async (_args: unknown) => ({ teamId: 'T_TEST' }));
const findUser = mock(async (_args: unknown) => null as null | { id: string; displayName: string | null; phone: string | null });
const createUser = mock(async (_args: unknown) => ({ id: 'usr_new' }));
const updateUser = mock(async (_args: unknown) => ({ id: 'usr_existing' }));
const upsertChannelIdentity = mock(async (_args: unknown) => ({ id: 'ci_slack' }));
const upsertSlackUserBinding = mock(async (_args: unknown) => ({ id: 'sub_1' }));

const realDb = await import('@sendero/database');
mock.module('@sendero/database', () => ({
  ...realDb,
  prisma: {
    slackInstall: { findFirst: findSlackInstall },
    user: {
      findUnique: findUser,
      create: createUser,
      update: updateUser,
    },
    channelIdentity: { upsert: upsertChannelIdentity },
    slackUserBinding: { upsert: upsertSlackUserBinding },
  },
}));

const { createPassengerTool } = await import('./create-passenger');

const ctx = {
  traveler: { tenantId: 'ten_1', userId: 'operator_1' },
};

beforeEach(() => {
  findSlackInstall.mockClear();
  findUser.mockClear();
  createUser.mockClear();
  updateUser.mockClear();
  upsertChannelIdentity.mockClear();
  upsertSlackUserBinding.mockClear();
  findSlackInstall.mockImplementation(async () => ({ teamId: 'T_TEST' }));
  findUser.mockImplementation(async () => null);
});

describe('create_passenger Slack binding', () => {
  test('creates SlackUserBinding when attaching Slack identity', async () => {
    const result = await createPassengerTool.handler(
      {
        email: 'traveler@example.com',
        displayName: 'Traveler One',
        channel: 'slack',
        externalUserId: 'U_TEST',
      },
      ctx
    );

    expect(result.channel).toBe('slack');
    expect(result.channelIdentityId).toBe('ci_slack');
    expect(upsertSlackUserBinding).toHaveBeenCalledTimes(1);
    expect(upsertSlackUserBinding.mock.calls[0]![0]).toMatchObject({
      where: {
        tenantId_slackTeamId_slackUserId: {
          tenantId: 'ten_1',
          slackTeamId: 'T_TEST',
          slackUserId: 'U_TEST',
        },
      },
      create: {
        tenantId: 'ten_1',
        slackTeamId: 'T_TEST',
        slackUserId: 'U_TEST',
        senderoUserId: 'usr_new',
        email: 'traveler@example.com',
      },
    });
  });

  test('refuses Slack identity when tenant has no active Slack install', async () => {
    findSlackInstall.mockImplementation(async () => null);

    await expect(
      createPassengerTool.handler(
        {
          email: 'traveler@example.com',
          channel: 'slack',
          externalUserId: 'U_TEST',
        },
        ctx
      )
    ).rejects.toThrow('cannot attach Slack');

    expect(createUser).not.toHaveBeenCalled();
    expect(upsertChannelIdentity).not.toHaveBeenCalled();
    expect(upsertSlackUserBinding).not.toHaveBeenCalled();
  });
});
