import { afterEach, describe, expect, test } from 'bun:test';

import '../../functions/sendero-whatsapp-support-ask-team-question/index.js';

import { InMemoryKv } from '../support/in-memory-kv.ts';

interface AskTeamQuestionRuntime {
  handler: (request: Request, env: Record<string, unknown>) => Promise<Response>;
  loadQuestion: (kv: InMemoryKv, questionId: string) => Promise<Record<string, unknown> | null>;
}

interface AskTeamQuestionGlobal {
  __senderoAskTeamQuestion: AskTeamQuestionRuntime;
}

const originalFetch = globalThis.fetch;
const askTeamQuestion = (globalThis as typeof globalThis & AskTeamQuestionGlobal)
  .__senderoAskTeamQuestion;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('handleAskTeamQuestion', () => {
  test('creates a Slack thread and reuses it for the same open execution', async () => {
    let postCount = 0;
    let postedBody: { text?: string } | null = null;
    globalThis.fetch = (async (_input, init) => {
      postCount += 1;
      postedBody = JSON.parse(String(init?.body ?? '{}'));
      return new Response(
        JSON.stringify({
          channel: 'C123',
          ok: true,
          ts: '111.222',
        }),
        {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }) as typeof fetch;

    const kv = new InMemoryKv();
    const env = {
      KV: kv,
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_CHANNEL_ID: 'C123',
      SLACK_ESCALATION_ASSIGNEE_ID: 'U_TOMAS',
    };

    const requestBody = {
      execution_context: {
        context: {
          contact: {
            profile_name: 'Alicia',
          },
          phone_number: '+15550000000',
        },
        system: {
          workflow_execution_id: 'execution_1',
        },
      },
      input: {
        question: 'Can we override the normal refund policy?',
        summary: 'VIP customer',
        title: 'Refund exception',
      },
      whatsapp_context: {
        conversation: {
          id: 'conversation_1',
        },
      },
    };

    const firstResponse = await askTeamQuestion.handler(
      new Request('https://example.com', {
        body: JSON.stringify(requestBody),
        method: 'POST',
      }),
      env
    );
    const secondResponse = await askTeamQuestion.handler(
      new Request('https://example.com', {
        body: JSON.stringify(requestBody),
        method: 'POST',
      }),
      env
    );

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(postCount).toBe(1);

    const firstBody = (await firstResponse.json()) as { question_id: string };
    const storedQuestion = await askTeamQuestion.loadQuestion(kv, firstBody.question_id);
    expect(storedQuestion?.workflowExecutionId).toBe('execution_1');
    expect(storedQuestion?.assignee).toEqual({
      email: null,
      name: 'Support owner',
      slackUserId: 'U_TOMAS',
    });
    expect(postedBody?.text).toContain('Assigned to: <@U_TOMAS>');

    const secondBody = (await secondResponse.json()) as { reused_existing_question?: boolean };
    expect(secondBody.reused_existing_question).toBe(true);
  });
});
