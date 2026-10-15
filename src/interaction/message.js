// @ts-check
import { relayError } from '../protocol.js';

// The JSON Schema is the public contract; this module also checks its cross-field rules.
export const MESSAGE_KINDS = Object.freeze(['question', 'answer', 'defer', 'withdrawal', 'notice']);
export const CLASSES = Object.freeze(['clarification', 'artifact-review', 'authorization']);
export const ITEM_TYPES = Object.freeze(['boolean', 'single', 'multi', 'text']);
export const SURFACES = Object.freeze(['phone', 'desktop', 'cli', 'terminal']);
export const LOCAL_SURFACES = Object.freeze(['desktop', 'cli', 'terminal']);
export const WITHDRAWAL_REASONS = Object.freeze(['asker', 'user', 'asker-gone', 'superseded', 'answered-elsewhere']);

const HARNESSES = ['claude-code', 'codex', 'opencode'];
const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
// Lowercase only: ids are compared exactly and name entry files, so two spellings of one UUID
// would be two entries that overwrite each other on a case-insensitive filesystem.
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
/** @type {(message: string) => never} */
const fail = (message) => { throw relayError('INVALID_MESSAGE', message); };
/** @type {(message: string) => never} */
const bad = (message) => { throw relayError('INVALID_ANSWER', message); };
/** @param {unknown} v @returns {v is Record<string, any>} */
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** @param {unknown} v */
export const isUuid = (v) => typeof v === 'string' && UUID.test(v);
/** @param {number} v */
const ms = (v) => Number.isSafeInteger(v) && v >= 0;
/** @param {string} v */
const characters = (v) => Array.from(v).length;
/** @param {unknown} v @param {number} min @param {number} max @returns {v is string} */
const str = (v, min, max) => {
  if (typeof v !== 'string') return false;
  const length = characters(v);
  return length >= min && length <= max;
};
/** @template T @param {T|null} v @param {(v: T) => boolean} check */
const orNull = (v, check) => v === null || check(v);
/** @param {unknown} v */
const isId = (v) => typeof v === 'string' && ID.test(v);
/** @param {string[]} ids @param {string} what */
const unique = (ids, what) => { if (new Set(ids).size !== ids.length) fail(`duplicate ${what} id`); };

/** @param {unknown} v @returns {import("../types.js").Party} */
function party(v) {
  if (object(v) && v.kind === 'user') return { kind: 'user' };
  if (object(v) && v.kind === 'agent' && typeof v.agentId === 'string' && /^(claude-code|codex|opencode):.+$/.test(v.agentId)) {
    return { kind: 'agent', agentId: v.agentId };
  }
  return fail('invalid party');
}

/** @param {unknown} v @returns {import("../types.js").Context} */
function context(v) {
  if (!object(v) || !orNull(v.project, (x) => typeof x === 'string')
      || !orNull(v.cwd, (x) => typeof x === 'string')
      || !orNull(v.taskId, (x) => typeof x === 'string' && /^[a-z0-9-]+-[0-9a-f]{6}$/.test(x))) fail('invalid context');
  return { project: v.project, taskId: v.taskId, cwd: v.cwd };
}

/** @param {unknown} v @returns {import("../types.js").Option} */
function option(v) {
  if (!object(v) || !isId(v.id) || !str(v.label, 1, 80) || !orNull(v.description, (x) => str(x, 0, 400))) fail('invalid option');
  return { id: v.id, label: v.label, description: v.description };
}

/** @param {unknown} v @returns {import("../types.js").Item} */
function item(v) {
  if (!object(v) || !isId(v.id) || !str(v.header, 1, 16) || !str(v.prompt, 1, 1000) || !ITEM_TYPES.includes(v.type)
      || !Array.isArray(v.options) || typeof v.allowOther !== 'boolean') fail('invalid item');
  const options = v.options.map(option);
  unique(options.map((o) => o.id), 'option');
  const choice = v.type === 'single' || v.type === 'multi';
  if (choice ? options.length < 2 || options.length > 4 : options.length !== 0) fail('invalid item options');
  if (!choice && (v.recommended !== null || v.allowOther)) fail('recommended and allowOther need options');
  if (v.recommended !== null && !options.some((o) => o.id === v.recommended)) fail('recommended is not an option');
  const length = Number.isInteger(v.maxLength) && v.maxLength >= 1 && v.maxLength <= 2000;
  if (v.type === 'text' ? !(v.maxLength === null || length) : v.maxLength !== null) fail('invalid maxLength');
  return { id: v.id, header: v.header, prompt: v.prompt, type: v.type, options, recommended: v.recommended, allowOther: v.allowOther, maxLength: v.maxLength };
}

/** @param {unknown} v @returns {import("../types.js").Question} */
function question(v) {
  if (!object(v) || !CLASSES.includes(v.class) || !ms(v.expiresAt) || !Array.isArray(v.items) || v.items.length < 1 || v.items.length > 4) fail('invalid question');
  let native = null, artifact = null;
  if (v.native !== null) {
    if (!object(v.native) || !HARNESSES.includes(v.native.harness) || !str(v.native.sessionId, 1, Infinity) || !str(v.native.callId, 1, Infinity)) fail('invalid native call');
    native = { harness: v.native.harness, sessionId: v.native.sessionId, callId: v.native.callId };
  }
  if (v.artifact !== null) {
    if (!object(v.artifact) || !str(v.artifact.ref, 1, Infinity) || !str(v.artifact.revision, 1, Infinity)) fail('invalid artifact');
    artifact = { ref: v.artifact.ref, revision: v.artifact.revision };
  }
  if (!orNull(v.supersedes, isUuid)) fail('invalid supersedes');
  const items = v.items.map(item);
  unique(items.map((i) => i.id), 'item');
  return { class: v.class, expiresAt: v.expiresAt, native, artifact, supersedes: v.supersedes, items };
}

/** @param {unknown} v @returns {import("../types.js").Value} */
function value(v) {
  if (!object(v)) fail('invalid value');
  if (v.type === 'boolean' && typeof v.value === 'boolean') return { type: 'boolean', value: v.value };
  if (v.type === 'choice' && Array.isArray(v.optionIds) && v.optionIds.length >= 1 && v.optionIds.length <= 4 && v.optionIds.every(isId)) {
    if (new Set(v.optionIds).size !== v.optionIds.length) fail('duplicate option in value');
    return { type: 'choice', optionIds: [...v.optionIds] };
  }
  if (v.type === 'other' && str(v.text, 1, 2000)) return { type: 'other', text: v.text };
  if (v.type === 'text' && str(v.text, 0, 2000)) return { type: 'text', text: v.text };
  return fail('invalid value');
}

/** @param {string} v */
const surface = (v) => SURFACES.includes(v) ? v : fail('invalid surface');

/** @param {unknown} v @returns {import("../types.js").Answer} */
function answer(v) {
  if (!object(v) || !isUuid(v.answerId) || !['answered', 'declined'].includes(v.outcome)
      || !orNull(v.artifactRevision, (x) => typeof x === 'string') || !object(v.values)) fail('invalid answer');
  return { answerId: v.answerId, surface: surface(v.surface), outcome: v.outcome, artifactRevision: v.artifactRevision,
    values: Object.fromEntries(Object.entries(v.values).map(([k, x]) => [k, value(x)])) };
}

/** @param {unknown} v @returns {import("../types.js").NoticeMessage["body"]} */
function notice(v) {
  if (!object(v) || !ms(v.expiresAt) || !str(v.title, 1, 80) || !str(v.text, 0, 2000) || !['info', 'warn'].includes(v.level)) fail('invalid notice');
  return { expiresAt: v.expiresAt, title: v.title, text: v.text, level: v.level };
}

/** @type {Record<string, (v: unknown) => unknown>} */
const BODY = {
  question,
  answer,
  defer: (v) => object(v) ? { surface: surface(v.surface) } : fail('invalid defer'),
  withdrawal: (v) => object(v) && WITHDRAWAL_REASONS.includes(v.reason) ? { reason: v.reason } : fail('invalid withdrawal'),
  notice,
};

/** @param {unknown} v @returns {import("../types.js").Message} */
export function validateMessage(v) {
  if (!object(v) || v.schema !== 1 || !MESSAGE_KINDS.includes(v.kind) || !isUuid(v.id) || !isUuid(v.correlationId) || !ms(v.createdAt)) fail('invalid message envelope');
  if ((v.kind === 'question' || v.kind === 'notice') && v.correlationId !== v.id) fail('a question or notice correlates to itself');
  return /** @type {import("../types.js").Message} */ ({ schema: 1, id: v.id, kind: v.kind, correlationId: v.correlationId, from: party(v.from), to: party(v.to),
    createdAt: v.createdAt, context: context(v.context), body: BODY[v.kind](v.body) });
}

/** @param {import("../types.js").Question} q @param {import("../types.js").Answer} a */
export function checkAnswer(q, a) {
  if ((q.artifact === null) !== (a.artifactRevision === null)) bad('artifactRevision must be present exactly when the question has an artifact');
  const keys = Object.keys(a.values);
  if (a.outcome === 'declined') { if (keys.length) bad('a declined answer carries no values'); return; }
  if (keys.length !== q.items.length || !q.items.every((i) => Object.hasOwn(a.values, i.id))) bad('an answer has one value per item');
  for (const item of q.items) {
    const v = a.values[item.id];
    if (item.type === 'boolean') { if (v.type !== 'boolean') bad(`${item.id} takes a boolean`); continue; }
    if (item.type === 'text') { if (v.type !== 'text' || characters(v.text) > (item.maxLength ?? 2000)) bad(`${item.id} takes text within its limit`); continue; }
    if (v.type === 'other') { if (!item.allowOther) bad(`${item.id} allows no other`); continue; }
    if (v.type !== 'choice' || (item.type === 'single' && v.optionIds.length !== 1)
        || !v.optionIds.every((id) => item.options.some((o) => o.id === id))) bad(`${item.id} takes options of its own`);
  }
}
