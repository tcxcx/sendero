const KAPSO_API_BASE_URL = 'https://api.kapso.ai';
const SLACK_API_BASE_URL = 'https://slack.com/api';
const QUESTION_PREFIX = 'sendero-support-question:';
const THREAD_PREFIX = 'sendero-support-thread:';
const OPEN_QUESTION_PREFIX = 'sendero-support-open-question:';
const MAX_REQUEST_AGE_SECONDS = 60 * 5;
const encoder = new TextEncoder();

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requireEnv(value, name) {
  if (!value) throw new Error(`Missing required runtime env: ${name}`);
  return value;
}

function questionKey(questionId) {
  return `${QUESTION_PREFIX}${questionId}`;
}

function threadKey(channelId, threadTs) {
  return `${THREAD_PREFIX}${channelId}:${threadTs}`;
}

function openQuestionKey(workflowExecutionId) {
  return `${OPEN_QUESTION_PREFIX}${workflowExecutionId}`;
}

async function loadQuestion(kv, questionId) {
  const raw = await kv.get(questionKey(questionId));
  return raw ? JSON.parse(raw) : null;
}

async function saveQuestion(kv, question) {
  await kv.put(questionKey(question.id), JSON.stringify(question));
}

async function getQuestionIdByThread(kv, channelId, threadTs) {
  return kv.get(threadKey(channelId, threadTs));
}

async function setThreadQuestionMapping(kv, channelId, threadTs, questionId) {
  await kv.put(threadKey(channelId, threadTs), questionId);
}

async function setOpenQuestionForExecution(kv, workflowExecutionId, questionId) {
  await kv.put(openQuestionKey(workflowExecutionId), questionId);
}

async function clearOpenQuestionForExecution(kv, workflowExecutionId) {
  await kv.delete(openQuestionKey(workflowExecutionId));
}

async function slackRequest(token, path, init = {}) {
  const response = await fetch(`${SLACK_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json();
  if (!response.ok || !body.ok) {
    throw new Error(`Slack API request failed for ${path}: ${body.error ?? response.statusText}`);
  }
  return body;
}

async function fetchThreadReplies(token, channelId, threadTs) {
  const query = new URLSearchParams({ channel: channelId, ts: threadTs });
  const body = await slackRequest(token, `/conversations.replies?${query.toString()}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return body.messages ?? [];
}

async function postThreadConfirmation(token, channelId, threadTs, answer) {
  await slackRequest(token, '/chat.postMessage', {
    method: 'POST',
    body: JSON.stringify({
      channel: channelId,
      text: `it's done agent answered the user thank you for your help\n\n${answer}`,
      thread_ts: threadTs,
    }),
  });
}

function aggregateThreadAnswer(messages, parentTs) {
  return messages
    .map(message => {
      if (!message.ts || message.ts === parentTs) return false;
      if (message.bot_id || message.subtype) return false;
      const text = message.text?.trim();
      if (!text) return false;
      return stripDoneSignals(text);
    })
    .filter(Boolean)
    .join('\n\n');
}

function normalizeDoneLine(text) {
  return text
    .trim()
    .replace(/^`+|`+$/g, '')
    .replace(/^:+|:+$/g, '')
    .trim()
    .toLowerCase();
}

function isDoneSignal(line) {
  const normalized = normalizeDoneLine(line);
  return ['done', '✅', '☑️', '☑', '✔️', '✔', 'white_check_mark'].includes(normalized);
}

function stripDoneSignals(text) {
  const kept = text
    .split(/\r?\n/)
    .filter(line => !isDoneSignal(line))
    .join('\n')
    .trim();
  return kept || '';
}

function bytesToHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) {
    mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return mismatch === 0;
}

async function createSlackSignature(signingSecret, timestamp, rawBody) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(signingSecret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign']
  );
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`v0:${timestamp}:${rawBody}`)
  );
  return `v0=${bytesToHex(new Uint8Array(digest))}`;
}

async function verifySlackSignature({ signingSecret, signature, timestamp, rawBody, now }) {
  if (!signature || !timestamp) return false;
  const numericTimestamp = Number(timestamp);
  if (!Number.isFinite(numericTimestamp)) return false;
  const nowSeconds = Math.floor((now ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - numericTimestamp) > MAX_REQUEST_AGE_SECONDS) return false;
  const expected = await createSlackSignature(signingSecret, timestamp, rawBody);
  return constantTimeEqual(expected, signature);
}

function isDoneMessage(event, channelId) {
  if (!event || event.type !== 'message') return false;
  if (event.channel !== channelId) return false;
  if (event.bot_id || event.subtype) return false;
  if (!event.thread_ts || !event.ts || event.thread_ts === event.ts) return false;
  const text = typeof event.text === 'string' ? event.text : '';
  return text.split(/\r?\n/).some(line => isDoneSignal(line));
}

async function resumeWorkflowExecution(apiKey, workflowExecutionId, answer) {
  const response = await fetch(
    `${KAPSO_API_BASE_URL}/platform/v1/workflow_executions/${workflowExecutionId}/resume`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({
        message: { kind: 'payload', data: answer },
      }),
    }
  );
  if (!response.ok) {
    const error = new Error(`Kapso resume failed with status ${response.status}`);
    error.status = response.status;
    throw error;
  }
}

function asTrimmedString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function resolveAppOrigin(env) {
  return asTrimmedString(env.SENDERO_APP_ORIGIN) ?? asTrimmedString(env.KAPSO_WEBHOOK_BASE_URL);
}

function resolveSupportToolsSecret(env) {
  return asTrimmedString(env.SUPPORT_TOOLS_SECRET) ?? asTrimmedString(env.KAPSO_WEBHOOK_SECRET);
}

async function updateDurableSupportTicket(env, question, answer) {
  if (!question.supportTicketId) return null;
  const appOrigin = resolveAppOrigin(env);
  const secret = resolveSupportToolsSecret(env);
  if (!appOrigin || !secret) return null;
  try {
    const response = await fetch(`${appOrigin.replace(/\/$/, '')}/api/internal/support/tools`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sendero-support-secret': secret,
      },
      body: JSON.stringify({
        operation: 'update_support_ticket',
        input: {
          tenant_id: question.metadata?.tenant_id,
          ticket_id: question.supportTicketId,
          status: 'resolved',
          summary: answer,
        },
      }),
    });
    if (!response.ok) return { error: `support_ticket_update_failed_${response.status}` };
    return response.json();
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function handler(request, env) {
  const rawBody = await request.text();
  const payload = rawBody ? JSON.parse(rawBody) : {};

  if (payload.type === 'url_verification') {
    return jsonResponse({ challenge: payload.challenge ?? '' });
  }

  const isValid = await verifySlackSignature({
    rawBody,
    signature: request.headers.get('x-slack-signature'),
    signingSecret: requireEnv(env.SLACK_SIGNING_SECRET, 'SLACK_SIGNING_SECRET'),
    timestamp: request.headers.get('x-slack-request-timestamp'),
  });
  const legacyToken = asTrimmedString(env.SLACK_VERIFICATION_TOKEN);
  const hasValidLegacyToken = legacyToken && payload.token === legacyToken;
  if (!isValid && !hasValidLegacyToken) {
    return jsonResponse(
      {
        error: 'invalid_slack_signature',
        has_signature: Boolean(request.headers.get('x-slack-signature')),
        has_timestamp: Boolean(request.headers.get('x-slack-request-timestamp')),
        has_legacy_token: Boolean(payload.token),
      },
      401
    );
  }

  if (payload.type !== 'event_callback') return jsonResponse({ ok: true });

  const slackChannelId = requireEnv(env.SLACK_CHANNEL_ID, 'SLACK_CHANNEL_ID');
  if (!isDoneMessage(payload.event, slackChannelId)) return jsonResponse({ ok: true });

  const questionId = await getQuestionIdByThread(
    env.KV,
    payload.event.channel,
    payload.event.thread_ts
  );
  if (!questionId) return jsonResponse({ ignored: 'unknown_thread', ok: true });

  const question = await loadQuestion(env.KV, questionId);
  if (!question || question.status === 'answered') {
    return jsonResponse({ ignored: 'question_already_answered', ok: true });
  }

  const replies = await fetchThreadReplies(
    requireEnv(env.SLACK_BOT_TOKEN, 'SLACK_BOT_TOKEN'),
    question.slackChannelId,
    question.slackMessageTs
  );
  const answer = aggregateThreadAnswer(replies, question.slackMessageTs);
  if (!answer) return jsonResponse({ ignored: 'empty_thread_answer', ok: true });

  let resumeAccepted = false;
  try {
    await resumeWorkflowExecution(
      requireEnv(env.KAPSO_API_KEY, 'KAPSO_API_KEY'),
      question.workflowExecutionId,
      answer
    );
    resumeAccepted = true;
  } catch (error) {
    if (![404, 422].includes(error?.status)) throw error;
  }

  question.answerText = answer;
  question.answeredAt = new Date().toISOString();
  question.status = 'answered';
  const durableTicket = await updateDurableSupportTicket(env, question, answer);
  if (durableTicket?.error) {
    question.metadata = {
      ...(question.metadata || {}),
      support_ticket_update_error: durableTicket.error,
    };
  }
  await saveQuestion(env.KV, question);
  await clearOpenQuestionForExecution(env.KV, question.workflowExecutionId);
  if (resumeAccepted) {
    await postThreadConfirmation(
      requireEnv(env.SLACK_BOT_TOKEN, 'SLACK_BOT_TOKEN'),
      question.slackChannelId,
      question.slackMessageTs,
      answer
    );
  }

  return jsonResponse({ ok: true, notified_slack: resumeAccepted, resumed: resumeAccepted });
}

if (globalThis.Bun) {
  globalThis.__senderoSlackEvents = {
    aggregateThreadAnswer,
    clearOpenQuestionForExecution,
    createSlackSignature,
    getQuestionIdByThread,
    handler,
    loadQuestion,
    saveQuestion,
    setOpenQuestionForExecution,
    setThreadQuestionMapping,
    verifySlackSignature,
  };
}
