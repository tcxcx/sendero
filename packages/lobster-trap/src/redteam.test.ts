import { describe, expect, test } from 'bun:test';

import { parseInspectAction, redTeamFixturePassed, senderoRedTeamFixtures } from './redteam';

describe('lobster trap red-team fixtures', () => {
  test('cover benign and high-risk Sendero agent paths', () => {
    expect(senderoRedTeamFixtures.map(fixture => fixture.category)).toEqual(
      expect.arrayContaining(['benign', 'prompt_injection', 'exfiltration', 'credential_leak'])
    );
  });

  test('parses common inspect output formats', () => {
    expect(parseInspectAction('verdict: DENY')).toBe('DENY');
    expect(parseInspectAction('action = HUMAN_REVIEW')).toBe('HUMAN_REVIEW');
    expect(parseInspectAction('Policy result ALLOW')).toBe('ALLOW');
  });

  test('compares observed policy action to expected action', () => {
    expect(redTeamFixturePassed({ expectedAction: 'DENY', observedAction: 'DENY' })).toBe(true);
    expect(redTeamFixturePassed({ expectedAction: 'DENY', observedAction: 'ALLOW' })).toBe(false);
  });
});
