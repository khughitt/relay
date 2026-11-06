// @ts-check

export const MODEL_RE = /^[\x21-\x3f\x41-\x7e]+$/;
export const EFFORT_RE = /^[a-z0-9-]+$/;

/** @typedef {{verified: boolean, agent: string, harness: string, model: string|null, effort: string|null, effortReason: 'not-recorded'|null, reason: string|null, source: Record<string, unknown>}} ModelAnswer */
/** @typedef {{answer: ModelAnswer, detail: string|null}} ModelResult */

/** @param {string} harness @param {string} reason @param {string} detail @param {Record<string, unknown>} [source] @returns {ModelResult} */
export function unverified(harness, reason, detail, source = {}) {
  return { answer: { verified: false, agent: harness, harness, model: null, effort: null,
    effortReason: null, reason, source }, detail };
}

/** @param {{harness: string, model: string, effort: string|null, source: Record<string, unknown>, effortDetail: string}} input @returns {ModelResult} */
export function verified({ harness, model, effort, source, effortDetail }) {
  if (!MODEL_RE.test(model)) return unverified(harness, 'unstampable', `model ${JSON.stringify(model)} cannot be stamped`, source);
  if (effort === '') effort = null;
  if (effort !== null && !EFFORT_RE.test(effort)) return unverified(harness, 'unstampable', `effort ${JSON.stringify(effort)} cannot be stamped`, source);
  return { answer: { verified: true, agent: `${harness}/${model}${effort === null ? '' : `@${effort}`}`,
    harness, model, effort, effortReason: effort === null ? 'not-recorded' : null, reason: null, source },
    detail: effort === null ? effortDetail : null };
}

/** @param {ModelResult} result @param {'json'|'pretty'} mode @returns {{stdout: string, stderr: string}} */
export function renderAnswer({ answer, detail }, mode) {
  if (mode === 'json') return { stdout: `${JSON.stringify(answer)}\n`, stderr: '' };
  const stderr = !answer.verified ? `relay: model unverified (${answer.reason}): ${detail}\n`
    : answer.effortReason === 'not-recorded' ? `relay: effort not recorded: ${detail}\n` : '';
  return { stdout: `${answer.agent}\n`, stderr };
}
