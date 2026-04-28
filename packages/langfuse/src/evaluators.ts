/**
 * @sendero/langfuse/evaluators — LLM-as-a-Judge evaluation runner
 *
 * Runs automated quality evaluations on AI responses.
 * Fire-and-forget — call via after() in Next.js or at turn end.
 * Gated on LANGFUSE_EVALUATORS=true (default off — each eval is an extra LLM call).
 *
 * Four built-in evaluators (travel-domain tuned):
 *   1. response-quality  (NUMERIC 1-5)            — overall answer quality
 *   2. hallucination     (BOOLEAN)                — fabricated flight/hotel data
 *   3. helpfulness       (CATEGORICAL)            — travel task helpfulness
 *   4. booking-accuracy  (NUMERIC 1-5)            — booking data accuracy
 */

import { isLangfuseEvaluatorsEnabled } from './client';
import { scoreTrace } from './scores';
import type { EvaluateParams, EvaluatorConfig, ScoreResult } from './types';

const RESPONSE_QUALITY: EvaluatorConfig = {
  name: 'response-quality',
  scoreName: 'response-quality',
  scoreDataType: 'NUMERIC',
  systemPrompt: `You are a quality evaluator for Sendero, an AI travel concierge.
Rate the assistant's response on a scale of 1-5:

1 = Completely wrong, irrelevant, or harmful
2 = Mostly wrong or unhelpful, major issues
3 = Partially correct but incomplete or unclear
4 = Good response with minor issues
5 = Excellent, accurate, complete, and well-formatted

Consider:
- Accuracy of travel information (routes, fares, policies)
- Relevance to the traveler's actual request
- Completeness (covers all required booking steps)
- Clarity and appropriate brevity for the channel

Respond with ONLY a single integer from 1 to 5.`,
};

const HALLUCINATION: EvaluatorConfig = {
  name: 'hallucination',
  scoreName: 'hallucination',
  scoreDataType: 'BOOLEAN',
  systemPrompt: `You are a hallucination detector for Sendero, an AI travel concierge.

Given the context (tool results: flight searches, hotel results, booking confirmations) and
the assistant's response, determine if the response contains specific claims NOT supported
by the provided context.

Focus on:
- Flight numbers, prices, departure/arrival times
- Hotel names, room types, rates
- PNR / booking reference numbers
- Settlement amounts in USDC

If the response ONLY contains information from the tool results, or is a general conversational
message, respond "no".
If the response contains fabricated travel data not in the tool results, respond "yes".

Respond with ONLY "yes" or "no".`,
};

const HELPFULNESS: EvaluatorConfig = {
  name: 'helpfulness',
  scoreName: 'helpfulness',
  scoreDataType: 'CATEGORICAL',
  systemPrompt: `You are evaluating the helpfulness of Sendero, an AI travel concierge.

Categorize the response as:
- "helpful" — directly advances the traveler toward their booking goal
- "partial" — addresses it somewhat but leaves the traveler in an unclear state
- "not-helpful" — doesn't address the request, is evasive, or introduces confusion

Respond with ONLY one of: helpful, partial, not-helpful`,
};

const BOOKING_ACCURACY: EvaluatorConfig = {
  name: 'booking-accuracy',
  scoreName: 'booking-accuracy',
  scoreDataType: 'NUMERIC',
  systemPrompt: `You are evaluating the accuracy of booking information in a Sendero travel assistant response.

Evaluate whether the booking details (flight number, price in USDC, departure time, hotel name, dates)
are accurately relayed from the tool results to the traveler.

Rate 1-5:
1 = Major errors (wrong flight number, wrong price, wrong dates)
2 = Some errors (correct flight but wrong price or time)
3 = Mostly correct with minor imprecision
4 = Accurate with cosmetic imprecision
5 = Fully accurate and clearly presented

If the response is not about a booking, rate 5.

Respond with ONLY a single integer from 1 to 5.`,
};

const BUILTIN_EVALUATORS: Record<string, EvaluatorConfig> = {
  'response-quality': RESPONSE_QUALITY,
  hallucination: HALLUCINATION,
  helpfulness: HELPFULNESS,
  'booking-accuracy': BOOKING_ACCURACY,
};

/**
 * Run evaluators on a completed trace. Fire-and-forget.
 *
 * @param params.traceId    - The trace to score
 * @param params.input      - User message
 * @param params.output     - Assistant response
 * @param params.context    - Tool results / retrieved context (optional)
 * @param params.evaluators - Which evaluators to run (default: all)
 */
export async function evaluateTrace(params: EvaluateParams): Promise<void> {
  if (!isLangfuseEvaluatorsEnabled()) return;

  const { traceId, input, output, context, evaluators: evalNames } = params;

  if (!output || output.trim().length === 0) return;

  const evaluatorsToRun = evalNames
    ? evalNames.filter(n => BUILTIN_EVALUATORS[n]).map(n => BUILTIN_EVALUATORS[n]!)
    : Object.values(BUILTIN_EVALUATORS);

  const results = await Promise.allSettled(
    evaluatorsToRun.map(evaluator => runEvaluator(evaluator, input, output, context))
  );

  for (const [i, result] of results.entries()) {
    if (result.status === 'fulfilled' && result.value) {
      const { name, value, dataType, comment } = result.value;
      scoreTrace(traceId, name, value, { dataType, comment }).catch(() => {});
    } else if (result.status === 'rejected') {
      console.warn('[langfuse] evaluator failed:', {
        evaluator: evaluatorsToRun[i]?.name,
        error: result.reason instanceof Error ? result.reason.message : result.reason,
      });
    }
  }
}

async function runEvaluator(
  evaluator: EvaluatorConfig,
  input: string,
  output: string,
  context?: string
): Promise<ScoreResult> {
  const { generateText } = await import('ai');
  // Use a cost-efficient model for evaluations
  const { openai } = await import('@ai-sdk/openai');

  const userPrompt = [
    '## User Message',
    input,
    '',
    context ? `## Context (Tool Results)\n${context}\n` : '',
    '## Assistant Response',
    output,
  ]
    .filter(Boolean)
    .join('\n');

  const { text } = await generateText({
    model: openai('gpt-4.1-nano'),
    system: evaluator.systemPrompt,
    prompt: userPrompt,
    maxOutputTokens: 20,
    temperature: 0,
    experimental_telemetry: {
      isEnabled: true,
      functionId: `sendero-eval-${evaluator.name}`,
      metadata: { evaluator: evaluator.name },
    },
  });

  return parseEvaluatorResponse(evaluator, text.trim());
}

function parseEvaluatorResponse(evaluator: EvaluatorConfig, response: string): ScoreResult {
  switch (evaluator.scoreDataType) {
    case 'NUMERIC': {
      const num = Number.parseInt(response, 10);
      return {
        name: evaluator.scoreName,
        value: Number.isNaN(num) ? 3 : Math.min(5, Math.max(1, num)),
        dataType: 'NUMERIC',
        comment: `Judge rated: ${response}`,
      };
    }
    case 'BOOLEAN': {
      const isTrue = response.toLowerCase().startsWith('yes');
      return {
        name: evaluator.scoreName,
        value: isTrue,
        dataType: 'BOOLEAN',
        comment: `Judge: ${response}`,
      };
    }
    case 'CATEGORICAL': {
      const validValues = ['helpful', 'not-helpful', 'partial'];
      const normalized = response.toLowerCase().trim();
      const value = validValues.includes(normalized) ? normalized : 'partial';
      return {
        name: evaluator.scoreName,
        value,
        dataType: 'CATEGORICAL',
        comment: `Judge: ${response}`,
      };
    }
  }
}
