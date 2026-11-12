// @ts-check
// Process-group membership and containment for one subscriber invocation. A subscriber leads its
// own group (spawned detached); its supported descendants inherit that group. Membership is
// identity-only (pid, start, state) and kept separate from registry liveness.
// Linux reads /proc; other platforms report membership unavailable, which makes containment of
// surviving descendants fail rather than guess. See docs/api.md ("Subscriber containment").
import { readdirSync, readFileSync } from 'node:fs';
import { relayError } from '../protocol.js';

/** @typedef {{pid: number, start: string, state: string}} Member */

/** @param {string} text @returns {{pid: number, pgrp: number, state: string, start: string}|null} */
export function parseGroupStat(text) {
  const open = text.indexOf('('), close = text.lastIndexOf(')');
  if (open < 0 || close < open) return null;
  const pid = Number(text.slice(0, open).trim()), after = text.slice(close + 1).trim().split(/\s+/);
  const pgrp = Number(after[2]), start = after[19];
  if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(pgrp) || !/^[A-Za-z]$/.test(after[0] ?? '') || !/^[0-9]+$/.test(start ?? '')) return null;
  return { pid, pgrp, state: after[0], start };
}

/**
 * Every process whose group is pgid, zombies included. Bounded by the deadline: a scan that cannot
 * finish in time throws DEADLINE_EXCEEDED rather than return a partial list.
 * @param {number} pgid @param {{deadline?: number, clock?: () => number, platform?: string, readDir?: (p: string) => string[], readText?: (p: string) => string}} [options]
 * @returns {Member[]}
 */
export function groupMembers(pgid, { deadline = Infinity, clock = performance.now.bind(performance), platform = process.platform,
  readDir = (p) => readdirSync(p), readText = (p) => readFileSync(p, 'utf8') } = {}) {
  if (platform !== 'linux') throw relayError('PROCESS_UNAVAILABLE', `process-group membership is unproven on ${platform}`);
  /** @type {Member[]} */
  const members = [];
  for (const name of readDir('/proc')) {
    if (!/^[0-9]+$/.test(name)) continue;
    if (clock() >= deadline) throw relayError('DEADLINE_EXCEEDED', 'process-group scan deadline exceeded');
    let text;
    try { text = readText(`/proc/${name}/stat`); } catch { continue; } // exited during the scan
    const row = parseGroupStat(text);
    if (row !== null && row.pgrp === pgid) members.push({ pid: row.pid, start: row.start, state: row.state });
  }
  return members;
}

/** True while any process (zombies included) is in the group. @param {number} pgid @param {(pid: number, signal: number|string) => void} [kill] */
export function groupExists(pgid, kill = (pid, signal) => process.kill(pid, signal)) {
  try { kill(-pgid, 0); return true; }
  catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ESRCH') return false;
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'EPERM') return true; // a member we may not signal still exists
    throw error;
  }
}

const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Contains one invocation's group: TERM its members, wait up to graceMs, KILL whatever remains, and
 * wait for every member (zombies included) to disappear before deadline.
 *
 * Identity binding: the group id is the leader's pid. While the leader is unreaped, or while any
 * member remains, Linux does not reuse that id. A signal is sent only after a fresh scan shows a
 * group consistent with this invocation: no member other than the recorded leader itself holds the
 * leader's pid, and every member started no earlier than the leader. A group failing that check is
 * reported failed and never signalled. The residual assumption is that pids do not wrap within the
 * cleanup window between the leader's reap and the first scan.
 * @param {number} pgid @param {{leader: Member, deadline: number, graceMs?: number, pollMs?: number, clock?: () => number, members?: typeof groupMembers, exists?: typeof groupExists, kill?: (pid: number, signal: string) => void}} options
 * @returns {Promise<{cleanup: 'complete'|'failed', survivors: Member[], signals: number}>}
 */
export async function containGroup(pgid, { leader, deadline, graceMs = 100, pollMs = 5, clock = performance.now.bind(performance),
  members = groupMembers, exists = groupExists, kill = (pid, signal) => process.kill(pid, signal) }) {
  let signals = 0;
  /** @type {Member[]} */
  let seen = [];
  const after = BigInt(leader.start);
  const ours = (/** @type {Member[]} */ now) => now.length > 0 && pgid === leader.pid
    && now.every((m) => BigInt(m.start) >= after && (m.pid !== leader.pid || m.start === leader.start));
  /** @param {number} until */
  const drained = async (until) => { while (clock() < until) { if (!exists(pgid)) return true; await sleep(pollMs); } return !exists(pgid); };
  if (!exists(pgid)) return { cleanup: 'complete', survivors: [], signals };
  for (const [signal, until] of /** @type {[string, number][]} */ ([['SIGTERM', Math.min(deadline, clock() + graceMs)], ['SIGKILL', deadline]])) {
    let now;
    try { now = members(pgid, { deadline, clock }); } catch { return { cleanup: 'failed', survivors: seen, signals }; }
    if (now.length === 0) { if (!exists(pgid)) return { cleanup: 'complete', survivors: [], signals }; return { cleanup: 'failed', survivors: seen, signals }; }
    if (!ours(now)) return { cleanup: 'failed', survivors: now, signals };
    seen = now;
    if (now.some((m) => m.state !== 'Z')) {
      try { kill(-pgid, signal); signals++; } catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ESRCH') return { cleanup: 'failed', survivors: now, signals }; }
    }
    if (await drained(until)) return { cleanup: 'complete', survivors: [], signals };
  }
  let survivors = seen;
  try { survivors = members(pgid, { deadline: Infinity, clock }); } catch {}
  return { cleanup: 'failed', survivors, signals };
}
