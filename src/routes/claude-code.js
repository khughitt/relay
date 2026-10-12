import { relayError } from '../protocol.js';
import { validateMessage } from '../interaction/message.js';

export const EXPIRY_MS = 23 * 3600 * 1000;
export const DECLINED = '(declined)';

export function toQuestion(payload, { now, id, project = null }) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)
      || payload.tool_name !== 'AskUserQuestion' || typeof payload.session_id !== 'string' || !payload.session_id
      || typeof payload.tool_use_id !== 'string' || !payload.tool_use_id) {
    throw relayError('INVALID_INPUT', 'not an AskUserQuestion call');
  }
  const questions = payload.tool_input?.questions;
  if (!Array.isArray(questions)) throw relayError('INVALID_INPUT', 'AskUserQuestion carries no questions');
  const prompts = questions.map((question) => question?.question).filter((prompt) => typeof prompt === 'string');
  if (new Set(prompts).size !== prompts.length) throw relayError('INVALID_INPUT', 'AskUserQuestion carries duplicate question text');
  const items = questions.map((q, i) => ({ id: `q${i + 1}`, header: q?.header, prompt: q?.question,
    type: q?.multiSelect === true ? 'multi' : 'single',
    options: Array.isArray(q?.options) ? q.options.map((o, j) => ({ id: `o${j + 1}`, label: o?.label, description: o?.description ?? null })) : null,
    recommended: null, allowOther: true, maxLength: null }));
  return validateMessage({ schema: 1, id, kind: 'question', correlationId: id,
    from: { kind: 'agent', agentId: `claude-code:${payload.session_id}` }, to: { kind: 'user' }, createdAt: now,
    context: { project, taskId: null, cwd: payload.cwd },
    body: { class: 'clarification', expiresAt: now + EXPIRY_MS,
      native: { harness: 'claude-code', sessionId: payload.session_id, callId: payload.tool_use_id },
      artifact: null, supersedes: null, items } });
}

export function nativeAnswers(question, answer) {
  return Object.fromEntries(question.body.items.map((item) => {
    if (answer.outcome === 'declined') return [item.prompt, DECLINED];
    const value = answer.values[item.id];
    if (value.type === 'choice') return [item.prompt, value.optionIds.map((id) => item.options.find((option) => option.id === id).label).join(', ')];
    return [item.prompt, value.type === 'boolean' ? String(value.value) : value.text];
  }));
}

export function allowReply(payload, question, answer) {
  const output = { hookEventName: 'PreToolUse', permissionDecision: 'allow',
    updatedInput: { ...payload.tool_input, answers: nativeAnswers(question, answer) } };
  if (answer.outcome === 'declined') output.additionalContext = 'The user chose not to answer these questions.';
  return { hookSpecificOutput: output };
}

export const denyReply = (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });

export function observedAnswers(payload) {
  const answers = payload?.tool_response?.answers;
  if (answers === null || typeof answers !== 'object' || Array.isArray(answers)
      || !Object.values(answers).every((value) => typeof value === 'string')) {
    throw relayError('INVALID_INPUT', 'PostToolUse carries no answers map');
  }
  return { ...answers };
}
