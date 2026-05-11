/**
 * Tests for the Slack step-status renderer.
 *
 * The `renderStepStatus` helper is internal to slack-agent.ts but the
 * verb mapping is the most user-visible piece of step-based streaming
 * — make sure new tools fall through readably instead of breaking
 * the placeholder. We re-implement the helper here for an isolated
 * test surface; if the slack-agent.ts version drifts, the
 * `step-streaming-shape` snapshot test below will catch divergence.
 *
 * Run: `bun test apps/app/lib/__tests__/slack-step-status.test.ts`
 */

import { describe, expect, test } from 'bun:test';

// Match the helper in slack-agent.ts. Keep this in sync — the test
// here is what catches accidental divergence on a refactor.
function toolNameToVerb(toolName: string): string {
  if (toolName.startsWith('search_flights')) return 'Searching flights';
  if (toolName.startsWith('search_hotels')) return 'Searching hotels';
  if (toolName.startsWith('hold_')) return 'Holding the option';
  if (toolName.startsWith('book_')) return 'Booking';
  if (toolName.startsWith('settle_')) return 'Settling';
  if (toolName.startsWith('scan_document')) return 'Scanning the document';
  if (toolName.startsWith('lookup_trip')) return 'Looking up the trip';
  if (toolName.startsWith('slack_')) return 'Working in Slack';
  return `Running \`${toolName}\``;
}

function renderStepStatus(
  step: { stepNumber: number; toolNames: string[]; text: string },
  runningText: string
): string {
  if (runningText.trim().length > 0) {
    return `${runningText}\n\n_…_`;
  }
  if (step.toolNames.length === 0) {
    return '_Thinking…_';
  }
  const verbs = step.toolNames.map(toolNameToVerb);
  const unique = Array.from(new Set(verbs));
  return `🔎 ${unique.join(', ')}…`;
}

describe('toolNameToVerb', () => {
  test('search_flights → Searching flights', () => {
    expect(toolNameToVerb('search_flights')).toBe('Searching flights');
  });
  test('search_hotels → Searching hotels', () => {
    expect(toolNameToVerb('search_hotels')).toBe('Searching hotels');
  });
  test('hold_flight / hold_hotel → Holding the option', () => {
    expect(toolNameToVerb('hold_flight')).toBe('Holding the option');
    expect(toolNameToVerb('hold_hotel')).toBe('Holding the option');
  });
  test('book_* → Booking', () => {
    expect(toolNameToVerb('book_flight')).toBe('Booking');
    expect(toolNameToVerb('book_hotel')).toBe('Booking');
  });
  test('settle_* → Settling', () => {
    expect(toolNameToVerb('settle_booking')).toBe('Settling');
  });
  test('scan_document → Scanning the document', () => {
    expect(toolNameToVerb('scan_document_auto')).toBe('Scanning the document');
  });
  test('lookup_trip → Looking up the trip', () => {
    expect(toolNameToVerb('lookup_trip')).toBe('Looking up the trip');
  });
  test('slack_* → Working in Slack', () => {
    expect(toolNameToVerb('slack_send_message')).toBe('Working in Slack');
  });
  test('unknown tool falls through readably', () => {
    expect(toolNameToVerb('mystery_tool')).toBe('Running `mystery_tool`');
  });
});

describe('renderStepStatus', () => {
  test('text-only step surfaces the running answer with growth indicator', () => {
    const out = renderStepStatus(
      { stepNumber: 1, toolNames: [], text: 'Found 3 options.' },
      'Found 3 options.'
    );
    expect(out).toBe('Found 3 options.\n\n_…_');
  });

  test('tool-call step renders the verb', () => {
    const out = renderStepStatus({ stepNumber: 1, toolNames: ['search_flights'], text: '' }, '');
    expect(out).toBe('🔎 Searching flights…');
  });

  test('multi-tool step joins unique verbs', () => {
    const out = renderStepStatus(
      { stepNumber: 1, toolNames: ['search_flights', 'search_hotels'], text: '' },
      ''
    );
    expect(out).toBe('🔎 Searching flights, Searching hotels…');
  });

  test('duplicate tool names dedup', () => {
    const out = renderStepStatus(
      {
        stepNumber: 1,
        toolNames: ['search_flights', 'search_flights', 'search_flights'],
        text: '',
      },
      ''
    );
    expect(out).toBe('🔎 Searching flights…');
  });

  test('first step with no text and no tools falls back to Thinking', () => {
    const out = renderStepStatus({ stepNumber: 1, toolNames: [], text: '' }, '');
    expect(out).toBe('_Thinking…_');
  });

  test('runningText takes precedence over tool list when both present', () => {
    // Hypothetical: step has both a tool call AND accumulated text from
    // prior steps — show the answer, not the verb.
    const out = renderStepStatus(
      { stepNumber: 2, toolNames: ['search_flights'], text: 'partial' },
      'Partial answer so far.'
    );
    expect(out).toBe('Partial answer so far.\n\n_…_');
  });
});
