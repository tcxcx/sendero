import { describe, expect, test } from 'bun:test';

import {
  buildSendableTravelerChannels,
  selectSendableTravelerChannel,
} from '@/lib/sendable-traveler-channels';

describe('sendable traveler channels', () => {
  test('ignores raw Slack ChannelIdentity without an active Slack binding install', () => {
    const channels = buildSendableTravelerChannels({
      channelIdentities: [
        { kind: 'slack', externalUserId: 'U_OTHER_WORKSPACE' },
        { kind: 'whatsapp', externalUserId: '+593980668984' },
      ],
      slackUserBindings: [],
      activeSlackTeamIds: new Set(),
    });

    expect(channels).toEqual([{ kind: 'whatsapp', handle: '+593980668984' }]);
    expect(selectSendableTravelerChannel(channels, 'slack')).toBe('whatsapp');
  });

  test('includes Slack only when binding team has an active install', () => {
    const channels = buildSendableTravelerChannels({
      channelIdentities: [{ kind: 'slack', externalUserId: 'U_STALE' }],
      slackUserBindings: [
        { slackTeamId: 'T_REVOKED', slackUserId: 'U_REVOKED' },
        { slackTeamId: 'T_ACTIVE', slackUserId: 'U_ACTIVE' },
      ],
      activeSlackTeamIds: new Set(['T_ACTIVE']),
    });

    expect(channels).toEqual([{ kind: 'slack', handle: 'U_ACTIVE' }]);
    expect(selectSendableTravelerChannel(channels, 'slack')).toBe('slack');
  });
});
