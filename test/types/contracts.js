// Checked by just check, never executed: these errors must remain compiler errors.
import { validateHandle, validateEvent } from '../../src/protocol.js';
import { validateMessage, checkAnswer } from '../../src/interaction/message.js';
import { createEntry } from '../../src/interaction/lifecycle.js';
import { nativeAnswers } from '../../src/routes/claude-code.js';
import { connectSocket } from '../../src/serve/client.js';

const handle = validateHandle({ platform: 'linux', host: 'host', bootId: null, pid: 1, start: '0' });
/** @type {import('../../src/types.js').Handle} */
const sameHandle = handle;
// @ts-expect-error Process starts are decimal strings, never numbers.
handle.start = 123;

const event = validateEvent({});
// @ts-expect-error Background counts are numbers.
event.background = { agents: '1', other: 0 };
// @ts-expect-error Event kinds use the normalized vocabulary.
event.kind = 'PreToolUse';
// @ts-expect-error Registry tools have a name.
event.tool = { command: 'true', input: {} };

const message = validateMessage({});
if (message.kind === 'question') {
  const entry = createEntry(message, { handback: false, waiter: sameHandle, now: 0 });
  // @ts-expect-error A notice cannot replace a question in its entry.
  entry.question = /** @type {import('../../src/types.js').NoticeMessage} */ ({});
  // @ts-expect-error Answer validation takes an answer body, never a message envelope.
  checkAnswer(message.body, message);
  // @ts-expect-error The native route consumes an answer body.
  nativeAnswers(message, { answerId: 'answer', surface: 'cli', outcome: 'answered', artifactRevision: null, values: { q1: { type: 'choice', optionIds: [1] } } });
}

const connection = await connectSocket('/unused');
const result = await connection.request('list');
if (result.ok) {
  /** @type {import('../../src/types.js').Entry[]} */
  const entries = result.entries;
  // @ts-expect-error A list response has no question answer.
  result.entry.answer;
  for (const entry of entries) {
    if (entry.kind === 'notice') {
      // @ts-expect-error Notice entries have no question route.
      entry.route.waiter;
    }
  }
}
// @ts-expect-error Unknown socket operations cannot be sent by checked callers.
connection.request('bogus');

/** @type {import('../../src/types.js').Agent} */
const row = { id: 'codex:w', harness: 'codex', sessionId: 'w', scope: 'worker', root: 'codex:r', process: null,
  cwd: '/repo', repoRoot: null, remote: null, projectKey: '/repo', project: 'repo', state: 'idle', updatedAt: 0 };
// @ts-expect-error Registry scopes are session, process or worker.
row.scope = 'thread';
// @ts-expect-error A root is an agent id, never a number.
row.root = 1;

const taken = await connection.request('take', { id: 'unused' });
if (taken.ok) {
  const body = taken.entry.answer.body;
  // @ts-expect-error A take reply is an entry, not a list.
  taken.entries;
}
