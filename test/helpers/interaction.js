import { randomUUID } from 'node:crypto';

export const uuid = () => randomUUID();
export const HANDLE = Object.freeze({ platform: 'linux', host: 'h', bootId: null, pid: 4242, start: '100' });
export const OTHER_HANDLE = Object.freeze({ ...HANDLE, pid: 4343 });
export const NOW = 1_800_000_000_000;

export function questionMessage(patch = {}) {
  const id = patch.id ?? uuid();
  const base = { schema: 1, id, kind: 'question', correlationId: id,
    from: { kind: 'agent', agentId: 'claude-code:s1' }, to: { kind: 'user' }, createdAt: NOW,
    context: { project: null, taskId: null, cwd: '/w' },
    body: { class: 'clarification', expiresAt: NOW + 3_600_000, native: { harness: 'claude-code', sessionId: 's1', callId: 'toolu_1' },
      artifact: null, supersedes: null,
      items: [{ id: 'q1', header: 'Shape', prompt: 'Which shape?', type: 'single',
        options: [{ id: 'o1', label: 'Circle', description: null }, { id: 'o2', label: 'Square', description: 'Four sides' }],
        recommended: null, allowOther: true, maxLength: null }] } };
  return { ...base, ...patch, body: { ...base.body, ...(patch.body ?? {}) } };
}

const reply = (question, kind, body) => ({ schema: 1, id: uuid(), kind, correlationId: question.id, from: { kind: 'user' },
  to: question.from, createdAt: NOW + 1000, context: question.context, body });

export function answerMessage(question, patch = {}) {
  return reply(question, 'answer', { answerId: uuid(), surface: 'phone', outcome: 'answered', artifactRevision: null,
    values: { q1: { type: 'choice', optionIds: ['o2'] } }, ...patch });
}

export const deferMessage = (question, surface = 'phone') => reply(question, 'defer', { surface });
export const withdrawalMessage = (question, reason = 'user') => reply(question, 'withdrawal', { reason });

export function noticeMessage(patch = {}) {
  const id = uuid();
  return { schema: 1, id, kind: 'notice', correlationId: id, from: { kind: 'agent', agentId: 'claude-code:s1' }, to: { kind: 'user' },
    createdAt: NOW, context: { project: null, taskId: null, cwd: null },
    body: { expiresAt: NOW + 60_000, title: 'Build done', text: 'All green.', level: 'info' }, ...patch };
}
