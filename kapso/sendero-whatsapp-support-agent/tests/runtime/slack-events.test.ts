import { afterEach, describe, expect, test } from 'bun:test';

import '../../functions/sendero-whatsapp-support-slack-events/index.js';

import { InMemoryKv } from '../support/in-memory-kv.ts';

interface SlackEventsRuntime {
  createSlackSignature: (
    signingSecret: string,
    timestamp: string,
    rawBody: string
  ) => Promise<string>;
  handler: (request: Request, env: Record<string, unknown>) => Promise<Response>;
  loadQuestion: (kv: InMemoryKv, questionId: string) => Promise<Record<string, unknown> | null>;
  saveQuestion: (kv: InMemoryKv, question: Record<string, unknown>) => Promise<void>;
  setOpenQuestionForExecution: (
    kv: InMemoryKv,
    workflowExecutionId: string,
    questionId: string
  ) => Promise<void>;
  setThreadQuestionMapping: (
    kv: InMemoryKv,
    channelId: string,
    threadTs: string,
    questionId: string
  ) => Promise<void>;
}

interface SlackEventsGlobal {
  __senderoSlackEvents: SlackEventsRuntime;
}

const originalFetch = globalThis.fetch;
const slackEvents = (globalThis as typeof globalThis & SlackEventsGlobal).__senderoSlackEvents;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function buildDoneRequest(rawBody: string, timestamp: string): Promise<Request> {
  return slackEvents.createSlackSignature('signing-secret', timestamp, rawBody).then(
    signature =>
      new Request('https://example.com', {
        body: rawBody,
        headers: {
          'Content-Type': 'application/json',
          'x-slack-request-timestamp': timestamp,
          'x-slack-signature': signature,
        },
        method: 'POST',
      })
  );
}

describe('handleSlackEvents', () => {
  test('aggregates thread replies and resumes the workflow', async () => {
    let resumeCalled = false;
    let confirmationText: string | null = null;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.includes('/conversations.replies')) {
        return new Response(
          JSON.stringify({
            messages: [
              { text: 'parent', ts: '111.222' },
              { text: 'First answer', ts: '111.223' },
              { text: 'done', ts: '111.224' },
              { text: 'Second answer', ts: '111.225' },
            ],
            ok: true,
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
          }
        );
      }

      if (url.includes('/workflow_executions/')) {
        resumeCalled = true;
        return new Response(JSON.stringify({ data: { id: 'execution_1' } }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        });
      }

      if (url.includes('/chat.postMessage')) {
        const payload = init?.body ? JSON.parse(String(init.body)) : {};
        confirmationText = payload.text ?? null;
        return new Response(JSON.stringify({ ok: true, ts: '111.226' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const kv = new InMemoryKv();
    const question = {
      answerText: null,
      answeredAt: null,
      conversationId: null,
      createdAt: '2026-04-17T00:00:00.000Z',
      id: 'question_1',
      metadata: {},
      questionText: 'What is the policy?',
      slackChannelId: 'C123',
      slackMessageTs: '111.222',
      status: 'pending',
      summary: null,
      title: 'Support Question',
      workflowExecutionId: 'execution_1',
    };

    await slackEvents.saveQuestion(kv, question);
    await slackEvents.setThreadQuestionMapping(
      kv,
      question.slackChannelId,
      question.slackMessageTs,
      question.id
    );
    await slackEvents.setOpenQuestionForExecution(kv, question.workflowExecutionId, question.id);

    const env = {
      KAPSO_API_KEY: 'kapso-key',
      KV: kv,
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_CHANNEL_ID: 'C123',
      SLACK_SIGNING_SECRET: 'signing-secret',
    };

    const rawBody = JSON.stringify({
      event: {
        channel: 'C123',
        text: 'done',
        thread_ts: '111.222',
        ts: '111.224',
        type: 'message',
      },
      type: 'event_callback',
    });
    const request = await buildDoneRequest(rawBody, String(Math.floor(Date.now() / 1000)));

    const response = await slackEvents.handler(request, env);
    const stored = await slackEvents.loadQuestion(kv, question.id);

    expect(response.status).toBe(200);
    expect(resumeCalled).toBe(true);
    expect(stored?.status).toBe('answered');
    expect(stored?.answerText).toBe('First answer\n\nSecond answer');
    expect(confirmationText).toContain("it's done agent answered the user thank you for your help");
    expect(confirmationText).toContain('First answer\n\nSecond answer');
  });

  test('accepts a done marker in the final line and strips it from the answer', async () => {
    let resumePayload: unknown = null;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.includes('/conversations.replies')) {
        return new Response(
          JSON.stringify({
            messages: [
              { text: 'parent', ts: '111.222' },
              { text: 'Here is the final answer.\n\ndone', ts: '111.223' },
            ],
            ok: true,
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
          }
        );
      }

      if (url.includes('/workflow_executions/')) {
        resumePayload = init?.body ? JSON.parse(String(init.body)) : null;
        return new Response(JSON.stringify({ data: { id: 'execution_1' } }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        });
      }

      if (url.includes('/chat.postMessage')) {
        return new Response(JSON.stringify({ ok: true, ts: '111.224' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const kv = new InMemoryKv();
    const question = {
      id: 'question_multiline',
      metadata: {},
      questionText: 'What is the policy?',
      slackChannelId: 'C123',
      slackMessageTs: '111.222',
      status: 'pending',
      title: 'Support Question',
      workflowExecutionId: 'execution_multiline',
    };

    await slackEvents.saveQuestion(kv, question);
    await slackEvents.setThreadQuestionMapping(
      kv,
      question.slackChannelId,
      question.slackMessageTs,
      question.id
    );
    await slackEvents.setOpenQuestionForExecution(kv, question.workflowExecutionId, question.id);

    const rawBody = JSON.stringify({
      event: {
        channel: 'C123',
        text: 'Here is the final answer.\n\ndone',
        thread_ts: '111.222',
        ts: '111.223',
        type: 'message',
      },
      type: 'event_callback',
    });
    const request = await buildDoneRequest(rawBody, String(Math.floor(Date.now() / 1000)));

    await slackEvents.handler(request, {
      KAPSO_API_KEY: 'kapso-key',
      KV: kv,
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_CHANNEL_ID: 'C123',
      SLACK_SIGNING_SECRET: 'signing-secret',
    });

    expect(resumePayload).toEqual({
      message: { kind: 'payload', data: 'Here is the final answer.' },
    });
  });

  test('accepts checkmark emoji as a done marker', async () => {
    let resumePayload: unknown = null;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.includes('/conversations.replies')) {
        return new Response(
          JSON.stringify({
            messages: [
              { text: 'parent', ts: '111.222' },
              { text: 'Emoji completion works', ts: '111.223' },
              { text: '✅', ts: '111.224' },
            ],
            ok: true,
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
          }
        );
      }

      if (url.includes('/workflow_executions/')) {
        resumePayload = init?.body ? JSON.parse(String(init.body)) : null;
        return new Response(JSON.stringify({ data: { id: 'execution_1' } }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        });
      }

      if (url.includes('/chat.postMessage')) {
        return new Response(JSON.stringify({ ok: true, ts: '111.225' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const kv = new InMemoryKv();
    const question = {
      id: 'question_checkmark',
      metadata: {},
      questionText: 'What is the policy?',
      slackChannelId: 'C123',
      slackMessageTs: '111.222',
      status: 'pending',
      title: 'Support Question',
      workflowExecutionId: 'execution_checkmark',
    };

    await slackEvents.saveQuestion(kv, question);
    await slackEvents.setThreadQuestionMapping(
      kv,
      question.slackChannelId,
      question.slackMessageTs,
      question.id
    );
    await slackEvents.setOpenQuestionForExecution(kv, question.workflowExecutionId, question.id);

    const rawBody = JSON.stringify({
      event: {
        channel: 'C123',
        text: '✅',
        thread_ts: '111.222',
        ts: '111.224',
        type: 'message',
      },
      type: 'event_callback',
    });
    const request = await buildDoneRequest(rawBody, String(Math.floor(Date.now() / 1000)));

    await slackEvents.handler(request, {
      KAPSO_API_KEY: 'kapso-key',
      KV: kv,
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_CHANNEL_ID: 'C123',
      SLACK_SIGNING_SECRET: 'signing-secret',
    });

    expect(resumePayload).toEqual({
      message: { kind: 'payload', data: 'Emoji completion works' },
    });
  });

  test('accepts Slack legacy verification token when signature verification fails', async () => {
    let resumeCalled = false;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes('/conversations.replies')) {
        return new Response(
          JSON.stringify({
            messages: [
              { text: 'parent', ts: '111.222' },
              { text: 'Legacy token path works', ts: '111.223' },
              { text: '`done`', ts: '111.224' },
            ],
            ok: true,
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
          }
        );
      }

      if (url.includes('/workflow_executions/')) {
        resumeCalled = true;
        return new Response(JSON.stringify({ data: { id: 'execution_1' } }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        });
      }

      if (url.includes('/chat.postMessage')) {
        return new Response(JSON.stringify({ ok: true, ts: '111.225' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const kv = new InMemoryKv();
    const question = {
      id: 'question_legacy',
      metadata: {},
      questionText: 'What is the policy?',
      slackChannelId: 'C123',
      slackMessageTs: '111.222',
      status: 'pending',
      title: 'Support Question',
      workflowExecutionId: 'execution_legacy',
    };

    await slackEvents.saveQuestion(kv, question);
    await slackEvents.setThreadQuestionMapping(
      kv,
      question.slackChannelId,
      question.slackMessageTs,
      question.id
    );
    await slackEvents.setOpenQuestionForExecution(kv, question.workflowExecutionId, question.id);

    const request = new Request('https://example.com', {
      body: JSON.stringify({
        event: {
          channel: 'C123',
          text: '`done`',
          thread_ts: '111.222',
          ts: '111.224',
          type: 'message',
        },
        token: 'legacy-token',
        type: 'event_callback',
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    const response = await slackEvents.handler(request, {
      KAPSO_API_KEY: 'kapso-key',
      KV: kv,
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_CHANNEL_ID: 'C123',
      SLACK_SIGNING_SECRET: 'wrong-signing-secret',
      SLACK_VERIFICATION_TOKEN: 'legacy-token',
    });

    expect(response.status).toBe(200);
    expect(resumeCalled).toBe(true);
  });

  test('marks the question answered when the workflow is already no longer waiting', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes('/conversations.replies')) {
        return new Response(
          JSON.stringify({
            messages: [
              { text: 'parent', ts: '111.222' },
              { text: 'Final internal answer', ts: '111.223' },
            ],
            ok: true,
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
          }
        );
      }

      if (url.includes('/workflow_executions/')) {
        return new Response(JSON.stringify({ error: 'Execution is not waiting' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 422,
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const kv = new InMemoryKv();
    const question = {
      answerText: null,
      answeredAt: null,
      conversationId: null,
      createdAt: '2026-04-17T00:00:00.000Z',
      id: 'question_2',
      metadata: {},
      questionText: 'What is the policy?',
      slackChannelId: 'C123',
      slackMessageTs: '111.222',
      status: 'pending',
      summary: null,
      title: 'Support Question',
      workflowExecutionId: 'execution_2',
    };

    await slackEvents.saveQuestion(kv, question);
    await slackEvents.setThreadQuestionMapping(
      kv,
      question.slackChannelId,
      question.slackMessageTs,
      question.id
    );
    await slackEvents.setOpenQuestionForExecution(kv, question.workflowExecutionId, question.id);

    const env = {
      KAPSO_API_KEY: 'kapso-key',
      KV: kv,
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_CHANNEL_ID: 'C123',
      SLACK_SIGNING_SECRET: 'signing-secret',
    };

    const rawBody = JSON.stringify({
      event: {
        channel: 'C123',
        text: 'done',
        thread_ts: '111.222',
        ts: '111.224',
        type: 'message',
      },
      type: 'event_callback',
    });
    const request = await buildDoneRequest(rawBody, String(Math.floor(Date.now() / 1000)));

    await slackEvents.handler(request, env);
    const stored = await slackEvents.loadQuestion(kv, question.id);

    expect(stored?.status).toBe('answered');
    expect(stored?.answerText).toBe('Final internal answer');
  });
});
