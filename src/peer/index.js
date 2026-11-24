// @ts-check
// Peer runs (docs/questions.md, "Peer runs"): two sessions working on one task, derived from the
// inbox's notices. A run has no state of its own; every reader folds the same log in sequence order.
import { isDeepStrictEqual } from 'node:util';
import { validateHandle } from '../handle.js';
import { isUuid } from '../interaction/message.js';

export const RUN_MS = 7 * 24 * 3600 * 1000;
export const TEXT_LIMIT = 2000;
const TITLE = /^peer\/1 ([0-9a-f-]{36}) (open|join|message|close)$/;

/**
 * @param {{kind: import("../types.js").PeerKind, run: string, expiresAt: number, from: string|null, to: string, taskId: string, project: string|null, cwd: string|null, text: string, id: string, now: number}} options
 * A null sender is the user, who may only close.
 * @returns {import("../types.js").NoticeMessage}
 */
export function peerNotice({ kind, run, expiresAt, from, to, taskId, project, cwd, text, id, now }) {
  return { schema: 1, id, kind: 'notice', correlationId: id, from: from === null ? { kind: 'user' } : { kind: 'agent', agentId: from },
    to: { kind: 'agent', agentId: to }, createdAt: now, context: { project, taskId, cwd },
    body: { expiresAt, title: `peer/1 ${run} ${kind}`, text, level: 'info' } };
}

/** @param {string} text @returns {import("../types.js").Handle|null} */
function boundProcess(text) {
  try {
    const value = JSON.parse(text);
    const process = validateHandle(value?.process);
    return isDeepStrictEqual(process, value.process) ? process : null;
  } catch { return null; } // a notice this module did not write binds nothing
}

/**
 * The task's latest run. A notice that does not fit the run as it stood at its sequence is ignored.
 * @param {import("../types.js").PeerEntry[]} entries @param {string} taskId @param {number} now
 * @returns {import("../types.js").PeerRun|null}
 */
export function runFor(entries, taskId, now) {
  /** @type {import("../types.js").PeerRun|null} */
  let run = null;
  /** @param {import("../types.js").PeerRun} r @param {number} at */
  const over = (r, at) => r.closed !== null || at >= r.expiresAt;
  for (const entry of [...entries].sort((a, b) => a.seq - b.seq)) {
    if (entry.kind !== 'notice' || entry.notice.context.taskId !== taskId) continue;
    const { from, to, createdAt, body } = entry.notice, title = TITLE.exec(body.title);
    if (!title || !isUuid(title[1]) || to.kind !== 'agent') continue;
    const [, id, kind] = title, sender = from.kind === 'agent' ? from.agentId : null;
    if (kind === 'open') {
      const process = boundProcess(body.text);
      if (sender === null || to.agentId !== sender || process === null || (run && !over(run, createdAt))) continue;
      run = { id, taskId, lead: { agentId: sender, process }, reviewer: null, state: 'open', expiresAt: body.expiresAt, closed: null, notices: [] };
      continue;
    }
    if (!run || run.id !== id || over(run, createdAt)) continue;
    if (kind === 'close') { run.closed = { by: sender ?? 'user', reason: body.text, seq: entry.seq }; continue; }
    if (sender === null) continue;
    if (kind === 'join') {
      const process = boundProcess(body.text);
      if (run.reviewer !== null || sender === run.lead.agentId || to.agentId !== run.lead.agentId || process === null) continue;
      run.reviewer = { agentId: sender, process };
    } else if (run.reviewer === null || ![run.lead.agentId, run.reviewer.agentId].includes(sender)
      || to.agentId !== peerOf(run, sender)?.agentId) continue;
    run.notices.push({ seq: entry.seq, id: entry.id, kind: /** @type {'join'|'message'} */ (kind), from: sender, to: to.agentId, text: body.text, at: createdAt, seen: entry.seen });
  }
  if (run) run.state = run.closed ? 'closed' : now >= run.expiresAt ? 'expired' : 'open';
  return run;
}

/** @param {import("../types.js").PeerRun} run @param {string} agentId @returns {import("../types.js").PeerRole|null} */
export const roleOf = (run, agentId) => run.lead.agentId === agentId ? 'lead' : run.reviewer?.agentId === agentId ? 'reviewer' : null;
/** @param {import("../types.js").PeerRun} run @param {string} agentId */
export const peerOf = (run, agentId) => run.lead.agentId === agentId ? run.reviewer : run.lead;
