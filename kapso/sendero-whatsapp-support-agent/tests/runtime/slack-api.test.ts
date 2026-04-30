import { describe, expect, test } from 'bun:test';

import '../../functions/sendero-whatsapp-support-ask-team-question/index.js';
import '../../functions/sendero-whatsapp-support-slack-events/index.js';

interface AskTeamQuestionRuntime {
  formatSupportQuestionMessage: (question: Record<string, unknown>) => string;
}

interface SlackEventsRuntime {
  aggregateThreadAnswer: (messages: Array<Record<string, unknown>>, parentTs: string) => string;
}

interface RuntimeGlobals {
  __senderoAskTeamQuestion: AskTeamQuestionRuntime;
  __senderoSlackEvents: SlackEventsRuntime;
}

const runtime = globalThis as typeof globalThis & RuntimeGlobals;
const askTeamQuestion = runtime.__senderoAskTeamQuestion;
const slackEvents = runtime.__senderoSlackEvents;

describe('slack-api helpers', () => {
  test('aggregates only relevant thread replies', () => {
    const answer = slackEvents.aggregateThreadAnswer(
      [
        { text: 'parent', ts: '1.0' },
        { text: 'First answer', ts: '1.1' },
        { text: 'done', ts: '1.2' },
        { bot_id: 'B123', text: 'bot reply', ts: '1.3' },
        { subtype: 'message_changed', text: 'edited', ts: '1.4' },
        { text: 'Second answer', ts: '1.5' },
      ],
      '1.0'
    );

    expect(answer).toBe('First answer\n\nSecond answer');
  });

  test('formats the support question message with core context', () => {
    const message = askTeamQuestion.formatSupportQuestionMessage({
      answerText: null,
      answeredAt: null,
      conversationId: 'conversation_1',
      createdAt: '2026-04-17T00:00:00.000Z',
      id: 'question_1',
      metadata: {
        customer_phone_number: '+15555555555',
        customer_profile_name: 'Alicia',
      },
      questionText: 'Can we make an exception for a late refund request?',
      slackChannelId: 'C123',
      slackMessageTs: '111.222',
      status: 'pending',
      summary: 'VIP customer asking about refunds',
      title: 'Refund Policy',
      workflowExecutionId: 'execution_1',
    });

    expect(message).toContain('*Refund Policy*');
    expect(message).toContain('Customer phone: +15555555555');
    expect(message).toContain('Workflow execution: execution_1');
  });

  test('redacts dashboard support context tokens from Slack', () => {
    const message = askTeamQuestion.formatSupportQuestionMessage({
      id: 'question_1',
      metadata: {},
      questionText: 'Support context token: abc123.def456',
      slackChannelId: 'C123',
      slackMessageTs: '111.222',
      status: 'pending',
      summary: 'support_context_token: abc123.def456',
      title: 'Token safety',
      workflowExecutionId: 'execution_1',
    });

    expect(message).not.toContain('abc123.def456');
    expect(message).toContain('Support context token: [redacted]');
  });
});
