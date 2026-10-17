// Fixture Codex stores for the model resolver's tests.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** A UUIDv7 whose timestamp is `ms`. @param {number} ms */
export const threadAt = (ms) => { const hex = ms.toString(16).padStart(12, '0'); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7abc-8def-0123456789ab`; };
/** One rollout line. @param {string} type @param {Record<string, unknown>} payload @param {string} [timestamp] */
export const record = (type, payload, timestamp = '2026-10-17T10:00:00.000Z') => JSON.stringify({ timestamp, type, payload });
/** @param {string} id */
export const sessionMeta = (id) => record('session_meta', { id, cwd: '/w', base_instructions: { text: 'x'.repeat(100) } });
/** A turn_context with an effort; build one without the field through `record` directly. @param {string} model @param {string} timestamp @param {string|null} [effort] */
export const turnContext = (model, timestamp, effort = 'high') => record('turn_context', { turn_id: 't', model, effort }, timestamp);

/** A temporary store; files are named rollout-<stamp>-<thread>.jsonl. @param {import('node:test').TestContext} t */
export function tempStore(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-codex-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  /** @param {string} dir @param {string} thread @param {string[]} lines @param {{trailingNewline?: boolean, stamp?: string}} [options] */
  const write = (dir, thread, lines, { trailingNewline = true, stamp = '2026-10-17T06-00-00' } = {}) => {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `rollout-${stamp}-${thread}.jsonl`);
    fs.writeFileSync(file, lines.join('\n') + (trailingNewline ? '\n' : ''));
    return file;
  };
  return { root,
    /** @param {string[]} parts @param {string} thread @param {string[]} lines @param {{trailingNewline?: boolean, stamp?: string}} [options] */
    day: (parts, thread, lines, options) => write(path.join(root, 'sessions', ...parts), thread, lines, options),
    /** @param {string} thread @param {string[]} lines @param {{trailingNewline?: boolean, stamp?: string}} [options] */
    archived: (thread, lines, options) => write(path.join(root, 'archived_sessions'), thread, lines, options) };
}
