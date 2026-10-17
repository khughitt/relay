// @ts-check
// Codex's private rollout layout, read only. Observed on Codex 0.162.1 and 0.163.0; not a
// documented contract. Spec: docs/specs/2026-10-17-codex-model-resolver.md, "Resolution" steps 4-8.
import { readdirSync, openSync, readSync, fstatSync, closeSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { relayError } from '../protocol.js';

export const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const SCAN_LIMIT = 64 * 1024 * 1024;
const BLOCK = 64 * 1024;
const NEWLINE = 0x0a;
const ISO_UTC = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$/;

/** The store: CODEX_HOME when set, else HOME/.codex. Each must be absolute. @param {NodeJS.ProcessEnv} env */
export function storeRoot(env) {
  if (env.CODEX_HOME !== undefined) {
    if (!isAbsolute(env.CODEX_HOME)) throw relayError('INVALID_CONFIG', 'CODEX_HOME must be an absolute path');
    return env.CODEX_HOME;
  }
  if (!env.HOME || !isAbsolute(env.HOME)) throw relayError('INVALID_CONFIG', 'CODEX_HOME is unset and HOME is not an absolute path');
  return join(env.HOME, '.codex');
}

/** The local date of a UUIDv7's timestamp: the rollout's day directory. @param {string} thread @param {string} [timeZone] @returns {[string, string, string]} */
export function dayOf(thread, timeZone) {
  const ms = Number.parseInt(thread.slice(0, 8) + thread.slice(9, 13), 16);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
  /** @param {string} type */
  const part = (type) => /** @type {Intl.DateTimeFormatPart} */ (parts.find((p) => p.type === type)).value;
  return [part('year'), part('month'), part('day')];
}

/** A directory's entries, or null when it is absent. @param {string} dir @returns {string[]|null} */
export function listDir(dir) {
  try { return readdirSync(dir); }
  catch (caught) {
    const error = /** @type {import("../types.js").Failure} */ (caught);
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw relayError('IO_ERROR', `cannot list ${dir}`, error);
  }
}

/** Every rollout of `thread`: the UUIDv7 day directory first, the whole store only after a miss.
 * @param {string} root @param {string} thread @param {{timeZone?: string, list?: (dir: string) => string[]|null}} [options] */
export function locateRollout(root, thread, { timeZone, list = listDir } = {}) {
  const suffix = `-${thread}.jsonl`;
  /** @param {string} dir */
  const matches = (dir) => (list(dir) ?? []).filter((name) => name.startsWith('rollout-') && name.endsWith(suffix)).map((name) => join(dir, name));
  const sessions = join(root, 'sessions');
  const first = matches(join(sessions, ...dayOf(thread, timeZone)));
  if (first.length > 0) return first;
  /** @type {string[]} */
  const found = [];
  for (const year of list(sessions) ?? []) for (const month of list(join(sessions, year)) ?? [])
    for (const day of list(join(sessions, year, month)) ?? []) found.push(...matches(join(sessions, year, month, day)));
  found.push(...matches(join(root, 'archived_sessions')));
  return found;
}

/** @param {number} fd @param {Buffer} buffer @param {number} position */
function readExactly(fd, buffer, position) {
  for (let done = 0; done < buffer.length;) {
    const n = readSync(fd, buffer, done, buffer.length - done, position + done);
    if (n === 0) throw relayError('IO_ERROR', 'the rollout shrank while it was read');
    done += n;
  }
}
/** @template T @param {string} path @param {(fd: number, size: number) => T} body @returns {T} */
function withFile(path, body) {
  let fd;
  try { fd = openSync(path, 'r'); }
  catch (cause) { throw relayError('IO_ERROR', `cannot open ${path}`, cause); }
  try { return body(fd, fstatSync(fd).size); } finally { closeSync(fd); }
}
/** @param {Buffer} bytes */
function parseLine(bytes) {
  try { return JSON.parse(bytes.toString('utf8')); }
  catch (cause) { throw relayError('INVALID_ROLLOUT', 'a rollout line is not valid JSON', cause); }
}

/** The first record, which must end within `limit` bytes. Each block is read and searched
 * once; the record is assembled once, when its newline is found.
 * @param {string} path @param {{limit?: number, block?: number}} [options] */
export function firstRecord(path, { limit = SCAN_LIMIT, block = BLOCK } = {}) {
  return withFile(path, (fd, size) => {
    /** @type {Buffer[]} */
    const parts = [];
    for (let pos = 0; pos < Math.min(size, limit); pos += block) {
      const chunk = Buffer.alloc(Math.min(block, size - pos));
      readExactly(fd, chunk, pos);
      const end = chunk.indexOf(NEWLINE);
      if (end >= 0) return parseLine(Buffer.concat([...parts, chunk.subarray(0, end)]));
      parts.push(chunk);
    }
    throw relayError('INVALID_ROLLOUT', 'the rollout has no complete first record');
  });
}

/** The last turn_context within `limit` bytes of the end, read backward. The part after the
 * file's last newline is empty or a write in progress and is skipped; any other line that is
 * not JSON fails. Each block is read and searched once; a record spanning blocks is kept as
 * its fragments and assembled once, when the newline before it is found.
 * @param {string} path @param {{limit?: number, block?: number}} [options]
 * @returns {{record: Record<string, any>|null, limited: boolean}} */
export function lastTurnContext(path, { limit = SCAN_LIMIT, block = BLOCK } = {}) {
  return withFile(path, (fd, size) => {
    let pos = size, final = true;
    /** Fragments of the record being read backward, oldest first. @type {Buffer[]} */
    let tail = [];
    /** @param {Buffer[]} parts */
    const consider = (parts) => {
      if (final) { final = false; return null; }
      const parsed = parseLine(parts.length === 1 ? parts[0] : Buffer.concat(parts));
      return parsed?.type === 'turn_context' ? parsed : null;
    };
    while (pos > 0) {
      if (size - pos >= limit) return { record: null, limited: true };
      const length = Math.min(block, pos, limit - (size - pos));
      pos -= length;
      const chunk = Buffer.alloc(length);
      readExactly(fd, chunk, pos);
      let end = length;
      while (end > 0) {
        const at = chunk.lastIndexOf(NEWLINE, end - 1);
        if (at < 0) break;
        const found = consider([chunk.subarray(at + 1, end), ...tail]);
        tail = [];
        if (found) return { record: found, limited: false };
        end = at;
      }
      if (end > 0) tail.unshift(chunk.subarray(0, end));
    }
    return { record: consider(tail.length > 0 ? tail : [Buffer.alloc(0)]), limited: false };
  });
}

/** The model, effort and instant of a turn_context record. @param {Record<string, any>} record */
export function turnFields(record) {
  const { model, effort } = record.payload ?? {};
  if (typeof model !== 'string' || model === '') throw relayError('INVALID_ROLLOUT', 'turn_context has no model');
  if (effort !== undefined && effort !== null && typeof effort !== 'string') throw relayError('INVALID_ROLLOUT', 'turn_context effort is not a string');
  const at = typeof record.timestamp === 'string' && ISO_UTC.test(record.timestamp) ? Date.parse(record.timestamp) : NaN;
  if (!Number.isFinite(at)) throw relayError('INVALID_ROLLOUT', 'turn_context timestamp is not an ISO 8601 UTC instant');
  return { model, effort: /** @type {string|null} */ (effort ?? null), at };
}
