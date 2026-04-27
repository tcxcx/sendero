/**
 * Tests for slash-command parser + router + serializer.
 *
 * Run: `bun test packages/slack/src/slash-commands.test.ts`
 */

import { describe, expect, test } from 'bun:test';

import {
  parseSlashCommandBody,
  serializeSlashCommandResult,
  SlashCommandRouter,
  type SlashCommandPayload,
} from './slash-commands';

function urlEncode(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

describe('parseSlashCommandBody', () => {
  test('parses canonical Slack payload', () => {
    const body = urlEncode({
      command: '/sendero',
      text: 'note T_abc123 prefer aisle',
      user_id: 'U1',
      user_name: 'alice',
      team_id: 'T1',
      team_domain: 'acme',
      channel_id: 'C1',
      channel_name: 'general',
      response_url: 'https://hooks.slack.com/x',
      trigger_id: 'tr_abc',
      api_app_id: 'A1',
      is_enterprise_install: 'false',
    });
    const parsed = parseSlashCommandBody(body);
    expect(parsed?.command).toBe('/sendero');
    expect(parsed?.subcommand).toBe('note');
    expect(parsed?.args).toBe('T_abc123 prefer aisle');
    expect(parsed?.user).toEqual({ id: 'U1', name: 'alice' });
    expect(parsed?.team.domain).toBe('acme');
    expect(parsed?.responseUrl).toBe('https://hooks.slack.com/x');
    expect(parsed?.isEnterpriseInstall).toBe(false);
  });

  test('bare command (no text) sets subcommand and args to empty strings', () => {
    const parsed = parseSlashCommandBody(
      urlEncode({ command: '/sendero', text: '', team_id: 'T1', user_id: 'U1' })
    );
    expect(parsed?.subcommand).toBe('');
    expect(parsed?.args).toBe('');
  });

  test('subcommand with no args', () => {
    const parsed = parseSlashCommandBody(
      urlEncode({
        command: '/sendero',
        text: 'help',
        team_id: 'T1',
        user_id: 'U1',
      })
    );
    expect(parsed?.subcommand).toBe('help');
    expect(parsed?.args).toBe('');
  });

  test('enterprise_id present → enterprise object populated', () => {
    const parsed = parseSlashCommandBody(
      urlEncode({
        command: '/sendero',
        text: 'help',
        team_id: 'T1',
        user_id: 'U1',
        enterprise_id: 'E1',
        enterprise_name: 'AcmeOrg',
      })
    );
    expect(parsed?.enterprise).toEqual({ id: 'E1', name: 'AcmeOrg' });
  });

  test('no enterprise_id → enterprise is null', () => {
    const parsed = parseSlashCommandBody(
      urlEncode({ command: '/sendero', text: 'help', team_id: 'T1', user_id: 'U1' })
    );
    expect(parsed?.enterprise).toBeNull();
  });

  test('missing command → null', () => {
    expect(parseSlashCommandBody(urlEncode({ text: 'help' }))).toBeNull();
  });

  test('extra whitespace in text trimmed', () => {
    const parsed = parseSlashCommandBody(
      urlEncode({
        command: '/sendero',
        text: '  note   T_abc   ',
        team_id: 'T1',
        user_id: 'U1',
      })
    );
    expect(parsed?.subcommand).toBe('note');
    expect(parsed?.args).toBe('T_abc');
  });
});

describe('SlashCommandRouter', () => {
  function payload(subcommand: string, args = ''): SlashCommandPayload {
    return {
      command: '/sendero',
      text: `${subcommand} ${args}`.trim(),
      subcommand,
      args,
      user: { id: 'U1', name: 'alice' },
      team: { id: 'T1', domain: null },
      enterprise: null,
      channel: { id: 'C1', name: null },
      responseUrl: '',
      triggerId: 'tr_1',
      apiAppId: 'A1',
      isEnterpriseInstall: false,
    };
  }

  test('routes exact (command, subcommand) match', async () => {
    const router = new SlashCommandRouter().register('/sendero', 'help', async () => ({
      kind: 'reply',
      text: 'help text',
    }));
    const result = await router.dispatch(payload('help'));
    expect(result).toEqual({ kind: 'reply', text: 'help text' });
  });

  test('falls back to fallback handler when no subcommand matches', async () => {
    const router = new SlashCommandRouter().registerFallback('/sendero', async () => ({
      kind: 'reply',
      text: 'fallback',
    }));
    const result = await router.dispatch(payload('does-not-exist'));
    expect(result).toEqual({ kind: 'reply', text: 'fallback' });
  });

  test('returns ack when no exact and no fallback match', async () => {
    const router = new SlashCommandRouter();
    const result = await router.dispatch(payload('mystery'));
    expect(result).toEqual({ kind: 'ack' });
  });

  test('exact match preferred over fallback', async () => {
    const router = new SlashCommandRouter()
      .register('/sendero', 'help', async () => ({ kind: 'reply', text: 'exact' }))
      .registerFallback('/sendero', async () => ({ kind: 'reply', text: 'fallback' }));
    const result = await router.dispatch(payload('help'));
    expect(result).toEqual({ kind: 'reply', text: 'exact' });
  });
});

describe('serializeSlashCommandResult', () => {
  test('ack → empty object', () => {
    expect(serializeSlashCommandResult({ kind: 'ack' })).toEqual({});
  });

  test('reply with text only defaults to ephemeral', () => {
    expect(serializeSlashCommandResult({ kind: 'reply', text: 'hi' })).toEqual({
      text: 'hi',
      response_type: 'ephemeral',
    });
  });

  test('reply with explicit in_channel response_type', () => {
    expect(
      serializeSlashCommandResult({ kind: 'reply', text: 'hi', responseType: 'in_channel' })
    ).toEqual({ text: 'hi', response_type: 'in_channel' });
  });

  test('reply with blocks', () => {
    const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: 'x' } }];
    expect(serializeSlashCommandResult({ kind: 'reply', blocks })).toEqual({
      blocks,
      response_type: 'ephemeral',
    });
  });
});
