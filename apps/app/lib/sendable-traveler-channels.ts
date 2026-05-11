export interface TravelerChannelIdentityLike {
  kind: string;
  externalUserId?: string | null;
  businessScopedUserId?: string | null;
  username?: string | null;
}

export interface TravelerSlackBindingLike {
  slackTeamId: string;
  slackUserId: string;
}

export interface SendableTravelerChannel {
  kind: string;
  handle: string | null;
}

export function buildSendableTravelerChannels(args: {
  channelIdentities: TravelerChannelIdentityLike[];
  slackUserBindings: TravelerSlackBindingLike[];
  activeSlackTeamIds: Set<string>;
}): SendableTravelerChannel[] {
  const channels = args.channelIdentities
    .filter(identity => identity.kind !== 'slack')
    .map(identity => ({
      kind: String(identity.kind).toLowerCase(),
      handle: identity.externalUserId ?? identity.businessScopedUserId ?? identity.username ?? null,
    }));

  const seenChannels = new Set(channels.map(channel => channelKey(channel)));
  for (const binding of args.slackUserBindings) {
    if (!args.activeSlackTeamIds.has(binding.slackTeamId)) continue;
    const channel = { kind: 'slack', handle: binding.slackUserId };
    const key = channelKey(channel);
    if (seenChannels.has(key)) continue;
    seenChannels.add(key);
    channels.push(channel);
  }

  return channels;
}

export function selectSendableTravelerChannel(
  channels: SendableTravelerChannel[],
  preferred?: string | null
): string | null {
  const normalized = preferred?.toLowerCase() ?? null;
  if (normalized && channels.some(channel => channel.kind === normalized)) return normalized;
  return channels[0]?.kind ?? null;
}

function channelKey(channel: SendableTravelerChannel): string {
  return `${channel.kind}:${channel.handle ?? ''}`;
}
