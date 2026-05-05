const SLACK_API_BASE_URL = 'https://slack.com/api';
const QUESTION_PREFIX = 'sendero-support-question:';
const THREAD_PREFIX = 'sendero-support-thread:';
const OPEN_QUESTION_PREFIX = 'sendero-support-open-question:';
const DEFAULT_ASSIGNEE_EMAIL = null;
const DEFAULT_ASSIGNEE_NAME = 'Support owner';

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

function asTrimmedString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function redactSupportSecrets(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/(Support context token:\s*)[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gi, '$1[redacted]')
    .replace(/(support_context_token["':\s]+)[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gi, '$1[redacted]');
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

async function getOpenQuestionIdByExecution(kv, workflowExecutionId) {
  return kv.get(openQuestionKey(workflowExecutionId));
}

async function setOpenQuestionForExecution(kv, workflowExecutionId, questionId) {
  await kv.put(openQuestionKey(workflowExecutionId), questionId);
}

async function clearOpenQuestionForExecution(kv, workflowExecutionId) {
  await kv.delete(openQuestionKey(workflowExecutionId));
}

async function setThreadQuestionMapping(kv, channelId, threadTs, questionId) {
  await kv.put(threadKey(channelId, threadTs), questionId);
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

async function postQuestionToSlack(token, channelId, messageText) {
  const body = await slackRequest(token, '/chat.postMessage', {
    method: 'POST',
    body: JSON.stringify({ channel: channelId, text: messageText }),
  });
  return { channel: body.channel, ts: body.ts };
}

function resolveAppOrigin(env) {
  return asTrimmedString(env.SENDERO_APP_ORIGIN) ?? asTrimmedString(env.KAPSO_WEBHOOK_BASE_URL);
}

function resolveSupportToolsSecret(env) {
  return asTrimmedString(env.SUPPORT_TOOLS_SECRET) ?? asTrimmedString(env.KAPSO_WEBHOOK_SECRET);
}

async function createDurableSupportTicket(env, body, question) {
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
        operation: 'create_support_ticket',
        input: {
          ...(body.input || {}),
          assignee_email: question.assignee.email,
          assignee_name: question.assignee.name,
          assignee_slack_user_id: question.assignee.slackUserId,
          priority: question.priority,
          slack_channel_id: question.slackChannelId,
          slack_message_ts: question.slackMessageTs,
          source: 'whatsapp',
          summary: question.summary || question.questionText,
          title: question.title,
        },
        execution_context: body.execution_context || {},
        whatsapp_context: body.whatsapp_context || null,
      }),
    });
    if (!response.ok) return { error: `support_ticket_create_failed_${response.status}` };
    return response.json();
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function resolveAssignee(env, input) {
  const slackUserId =
    asTrimmedString(input.assignee_slack_user_id) ??
    asTrimmedString(env.SLACK_ESCALATION_ASSIGNEE_ID);
  const email =
    asTrimmedString(input.assignee_email) ??
    asTrimmedString(env.SUPPORT_ESCALATION_ASSIGNEE_EMAIL) ??
    DEFAULT_ASSIGNEE_EMAIL;
  const name =
    asTrimmedString(input.assignee_name) ??
    asTrimmedString(env.SUPPORT_ESCALATION_ASSIGNEE_NAME) ??
    DEFAULT_ASSIGNEE_NAME;

  return {
    email,
    name,
    slackUserId,
  };
}

function formatAssigneeMention(assignee) {
  const resolved = assignee ?? {
    email: DEFAULT_ASSIGNEE_EMAIL,
    name: DEFAULT_ASSIGNEE_NAME,
    slackUserId: null,
  };
  if (resolved.slackUserId) return `<@${resolved.slackUserId}>`;
  if (resolved.email) return `${resolved.name} (${resolved.email})`;
  return resolved.name;
}

function formatSupportQuestionMessage(question) {
  const lines = [`*${question.priority === 'urgent' ? '[urgent] ' : ''}${question.title}*`];
  lines.push(`Assigned to: ${formatAssigneeMention(question.assignee)}`);
  lines.push('', redactSupportSecrets(question.questionText));
  if (question.summary) lines.push('', `Summary: ${redactSupportSecrets(question.summary)}`);
  if (question.metadata.customer_phone_number) {
    lines.push('', `Customer phone: ${String(question.metadata.customer_phone_number)}`);
  }
  if (question.metadata.customer_profile_name) {
    lines.push(`Profile: ${String(question.metadata.customer_profile_name)}`);
  }
  lines.push('', `Workflow execution: ${question.workflowExecutionId}`);
  lines.push('Reply in this thread, then send `done` when the final answer is ready.');
  return lines.join('\n');
}

function resolveWorkflowExecutionId(body) {
  const system = body.execution_context?.system ?? {};
  return asTrimmedString(system.workflow_execution_id) ?? asTrimmedString(system.flow_execution_id);
}

async function handler(request, env) {
  const body = await request.json();
  const input = body.input ?? {};
  const questionText = asTrimmedString(input.question);
  if (!questionText) return jsonResponse({ error: 'question is required' }, 400);

  const workflowExecutionId = resolveWorkflowExecutionId(body);
  if (!workflowExecutionId) {
    return jsonResponse(
      { error: 'workflow execution id is missing from execution_context.system' },
      422
    );
  }

  const existingQuestionId = await getOpenQuestionIdByExecution(env.KV, workflowExecutionId);
  if (existingQuestionId) {
    const existing = await loadQuestion(env.KV, existingQuestionId);
    if (existing?.status === 'pending') {
      return jsonResponse({
        question_id: existing.id,
        reused_existing_question: true,
        slack_channel_id: existing.slackChannelId,
        slack_message_ts: existing.slackMessageTs,
        status: existing.status,
      });
    }
    await clearOpenQuestionForExecution(env.KV, workflowExecutionId);
  }

  const executionContext = body.execution_context ?? {};
  const runtimeContext = executionContext.context ?? {};
  const conversation = body.whatsapp_context?.conversation ?? {};
  const now = new Date().toISOString();
  const question = {
    answerText: null,
    answeredAt: null,
    assignee: resolveAssignee(env, input),
    conversationId:
      asTrimmedString(conversation.id) ?? asTrimmedString(runtimeContext.conversation_id),
    createdAt: now,
    id: crypto.randomUUID(),
    metadata: {
      customer_phone_number: asTrimmedString(runtimeContext.phone_number),
      customer_profile_name: asTrimmedString(runtimeContext.contact?.profile_name),
      flow_id: asTrimmedString(executionContext.system?.flow_id),
      flow_name: asTrimmedString(executionContext.system?.flow_name),
      flow_step_id: asTrimmedString(body.flow_info?.step_id),
      tenant_id: asTrimmedString(input.tenant_id) ?? asTrimmedString(input.tenantId),
      tenant_slug: asTrimmedString(input.tenant_slug) ?? asTrimmedString(input.tenantSlug),
    },
    priority: asTrimmedString(input.priority) === 'urgent' ? 'urgent' : 'normal',
    questionText,
    slackChannelId: '',
    slackMessageTs: '',
    status: 'pending',
    summary: asTrimmedString(input.summary),
    title: asTrimmedString(input.title) ?? 'Sendero WhatsApp support question',
    workflowExecutionId,
  };

  const slackMessage = await postQuestionToSlack(
    requireEnv(env.SLACK_BOT_TOKEN, 'SLACK_BOT_TOKEN'),
    requireEnv(env.SLACK_CHANNEL_ID, 'SLACK_CHANNEL_ID'),
    formatSupportQuestionMessage(question)
  );
  question.slackChannelId = slackMessage.channel;
  question.slackMessageTs = slackMessage.ts;
  const durableTicket = await createDurableSupportTicket(env, body, question);
  if (durableTicket?.ticket?.id) {
    question.supportTicketId = durableTicket.ticket.id;
  } else if (durableTicket?.error) {
    question.metadata.support_ticket_error = durableTicket.error;
  }

  await saveQuestion(env.KV, question);
  await setThreadQuestionMapping(env.KV, slackMessage.channel, slackMessage.ts, question.id);
  await setOpenQuestionForExecution(env.KV, workflowExecutionId, question.id);

  return jsonResponse({
    question_id: question.id,
    slack_channel_id: question.slackChannelId,
    slack_message_ts: question.slackMessageTs,
    status: question.status,
    support_ticket_id: question.supportTicketId ?? null,
  });
}

if (globalThis.Bun) {
  globalThis.__senderoAskTeamQuestion = {
    clearOpenQuestionForExecution,
    formatSupportQuestionMessage,
    getOpenQuestionIdByExecution,
    handler,
    loadQuestion,
    saveQuestion,
    setOpenQuestionForExecution,
    setThreadQuestionMapping,
  };
}
