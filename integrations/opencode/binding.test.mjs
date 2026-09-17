import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBinding, LEVEL_EVENTS } from './binding.js';

// createBinding's whole surface is three callbacks and an injected spawn/report -- no opencode in
// the room. The server plugin (`Relay`) is a three-line adapter over this; what has correctness
// worth proving is here.
const recorder = () => {
  const calls = [];
  const spawn = async (event, payload) => { calls.push({ event, payload }); };
  return { spawn, calls, events: () => calls.map((c) => c.event) };
};
const capture = () => {
  const msgs = [];
  return { report: (m) => msgs.push(m), msgs };
};

// The server-side event shapes, read off opencode's v1 SDK types.
const status = (sessionID, kind) => ({ event: { type: 'session.status', properties: { sessionID, status: { type: kind } } } });
const idle = (sessionID) => ({ event: { type: 'session.idle', properties: { sessionID } } });
const replied = (permissionID) => ({ event: { type: 'permission.replied', properties: { permissionID } } });
// The stable stream's ask. Its properties are the whole Permission, so the id sits at `id` --
// unlike the reply, which names it `permissionID`.
const askedOnStream = (id, sessionID = 's1') => ({
  event: { type: 'permission.updated', properties: { id, sessionID, type: 'bash', title: 'run it' } },
});
const errored = (sessionID) => ({ event: { type: 'session.error', properties: sessionID ? { sessionID } : {} } });

test('LEVEL_EVENTS is exactly the three stream events the window folds', () => {
  assert.deepEqual(
    [...LEVEL_EVENTS].sort(),
    ['permission.replied', 'permission.updated', 'session.status'],
  );
});

test('the payload keys the bus by the PROCESS, and takes cwd from opencode', async () => {
  const rec = recorder();
  const b = createBinding({ directory: '/home/k/proj', pid: 4242, spawn: rec.spawn });
  await b.dispose();
  assert.equal(rec.calls[0].payload.session_id, 'opencode:4242');
  assert.equal(rec.calls[0].payload.cwd, '/home/k/proj');
});

// init is pushed synchronously in createBinding, before the hooks exist for opencode to call -- so
// it is always first, without the subscription race a TUI plugin has to defend against.
test('init is enqueued FIRST, before any event', async () => {
  const rec = recorder();
  const b = createBinding({ directory: '/p', pid: 1, spawn: rec.spawn });
  b.onEvent(status('s1', 'busy'));
  await b.dispose();
  assert.deepEqual(rec.events(), ['init', 'session.busy', 'dispose']);
});

test('a busy session, a permission, and the fall back to busy', async () => {
  const rec = recorder();
  const b = createBinding({ directory: '/p', pid: 1, spawn: rec.spawn });
  b.onEvent(status('s1', 'busy'));
  b.onPermissionAsk({ id: 'r1', sessionID: 's1' });
  b.onEvent(replied('r1'));
  b.onEvent(status('s1', 'idle'));
  await b.dispose();
  assert.deepEqual(rec.events(), [
    'init', 'session.busy', 'permission.pending', 'session.busy', 'session.idle', 'dispose',
  ]);
});

// REGRESSION, and the one the physical-Mac terminal gate found. The `permission.ask` HOOK did not
// fire there, and the ask side was bound to nothing on the event stream, so the window ran
// busy -> idle with a permission dialog on screen the whole time and never reached
// `permission.pending`. The stable stream carries the ask as `permission.updated`; binding it makes
// the ask visible whether or not the hook fires.
test('an ask that arrives ONLY on the stream still raises the window', async () => {
  const rec = recorder();
  const b = createBinding({ directory: '/p', pid: 1, spawn: rec.spawn });
  b.onEvent(status('s1', 'busy'));
  b.onEvent(askedOnStream('r1'));      // no onPermissionAsk call: the hook stayed silent
  b.onEvent(replied('r1'));
  b.onEvent(status('s1', 'idle'));
  await b.dispose();
  assert.deepEqual(rec.events(), [
    'init', 'session.busy', 'permission.pending', 'session.busy', 'session.idle', 'dispose',
  ]);
});

// Both can arrive for one ask. The window holds ids in a Set, so the second is a no-op rather than
// a second `permission.pending` -- and one reply still drains it, leaving nothing stuck.
test('the hook and the stream describing the SAME ask raise the window once', async () => {
  const rec = recorder();
  const b = createBinding({ directory: '/p', pid: 1, spawn: rec.spawn });
  b.onEvent(status('s1', 'busy'));
  b.onPermissionAsk({ id: 'r1', sessionID: 's1' });
  b.onEvent(askedOnStream('r1'));
  b.onEvent(replied('r1'));
  b.onEvent(status('s1', 'idle'));
  await b.dispose();
  assert.deepEqual(rec.events(), [
    'init', 'session.busy', 'permission.pending', 'permission.pending',
    'session.busy', 'session.idle', 'dispose',
  ]);
});

// REGRESSION. opencode publishes the idle transition TWICE — the idle `session.status` AND a
// dedicated `session.idle` twin, both from the same `set()` call (session/status.ts:41-43). Only
// ONE may reach the hook. Two drive reduceState idle->done then done->idle and ERASE the `done`
// pose on every clean turn. So `session.idle` is NOT a level event; `session.status{idle}` alone
// drives the transition and the twin must add nothing.
test('opencode double-fires idle; the window transitions exactly once', async () => {
  const rec = recorder();
  const b = createBinding({ directory: '/p', pid: 1, spawn: rec.spawn });
  b.onEvent(status('s1', 'busy'));
  b.onEvent(status('s1', 'idle'));   // the real driver
  b.onEvent(idle('s1'));             // the redundant twin opencode fires in the same set()
  await b.dispose();
  assert.deepEqual(rec.events(), ['init', 'session.busy', 'session.idle', 'dispose']);
});

// THE SUBAGENT CASE: the child's permission ask carries the CHILD's sessionID, and it must still
// raise the window. There is no filter, by design.
test("a subagent's permission still reaches the window", async () => {
  const rec = recorder();
  const b = createBinding({ directory: '/p', pid: 1, spawn: rec.spawn });
  b.onEvent(status('parent', 'busy'));
  b.onEvent(status('child', 'busy'));
  b.onPermissionAsk({ id: 'r1', sessionID: 'child' });
  await b.dispose();
  assert.deepEqual(rec.events(), [
    'init', 'session.busy', 'session.busy', 'permission.pending', 'dispose',
  ]);
});

test('an error with a sessionID is an edge, and does not disturb the level', async () => {
  const rec = recorder();
  const b = createBinding({ directory: '/p', pid: 1, spawn: rec.spawn });
  b.onEvent(status('s1', 'busy'));
  b.onEvent(errored('s1'));
  b.onEvent(status('s1', 'idle'));
  await b.dispose();
  // The error rides between the two levels without changing either -- the idle `session.status` after
  // it is the one the adapter's reduceState turns back into `error`.
  assert.deepEqual(rec.events(), ['init', 'session.busy', 'session.error', 'session.idle', 'dispose']);
});

// `sessionID` is OPTIONAL on session.error, and opencode emits it without one for PLUGIN and SKILL
// load failures -- not the agent's turn failing, and not worth a demand state on every launch.
test('an error with NO sessionID is ignored', async () => {
  const rec = recorder();
  const b = createBinding({ directory: '/p', pid: 1, spawn: rec.spawn });
  b.onEvent(errored(null));
  await b.dispose();
  assert.deepEqual(rec.events(), ['init', 'dispose']);
});

// The event hook is a firehose -- token deltas, plugin churn, diffs. Everything not in LEVEL_EVENTS
// (and not session.error) must enqueue nothing.
test('the firehose is ignored — only the level events move the window', async () => {
  const rec = recorder();
  const b = createBinding({ directory: '/p', pid: 1, spawn: rec.spawn });
  for (const type of ['message.part.delta', 'plugin.added', 'session.diff', 'session.updated', 'todo.updated']) {
    b.onEvent({ event: { type, properties: {} } });
  }
  await b.dispose();
  assert.deepEqual(rec.events(), ['init', 'dispose']);
});

test('a failing hook is reported and does not stop the window', async () => {
  const calls = [];
  const spawn = async (event) => { calls.push(event); if (event === 'session.busy') throw Object.assign(new Error('private'), {code:'EAGAIN'}); };
  const cap = capture();
  const b = createBinding({ directory: '/p', pid: 1, spawn, report: cap.report });
  b.onEvent(status('s1', 'busy'));
  b.onEvent(status('s1', 'idle'));
  await b.dispose();
  assert.deepEqual(calls, ['init', 'session.busy', 'session.idle', 'dispose']);
  assert.equal(cap.msgs.length, 1);
  assert.match(cap.msgs[0], /session\.busy/);
  assert.match(cap.msgs[0], /EAGAIN/);
});

// A throw inside window.apply() -- a session status kind we do not know -- must NOT escape into
// opencode's dispatcher. It is caught at the seam, reported, and the window keeps working.
test('an unknown session.status kind is reported, not thrown into opencode', async () => {
  const rec = recorder();
  const cap = capture();
  const b = createBinding({ directory: '/p', pid: 1, spawn: rec.spawn, report: cap.report });
  await assert.doesNotReject(async () => b.onEvent(status('s1', 'thinking')));
  b.onEvent(status('s1', 'busy'));   // the window still works
  await b.dispose();
  assert.deepEqual(rec.events(), ['init', 'session.busy', 'dispose']);   // the bad event enqueued nothing
  assert.equal(cap.msgs.length, 1);
  assert.match(cap.msgs[0], /session\.status/);
  assert.match(cap.msgs[0], /INVALID_INPUT/);
});

test('no project directory is a loud failure, not a quiet guess', () => {
  assert.throws(() => createBinding({ directory: undefined, spawn: recorder().spawn }), /project directory/);
});

test('dispose is enqueued last', async () => {
  const rec = recorder();
  const b = createBinding({ directory: '/p', pid: 1, spawn: rec.spawn });
  b.onEvent(status('s1', 'busy'));
  await b.dispose();
  assert.equal(rec.events().at(-1), 'dispose');
});
import { mkdtemp,rm,readFile,stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeEvent } from '../../src/adapters/index.js';
test('queued init precedes work and dispose follows it',async()=>{
  const calls=[];const binding=createBinding({directory:'/repo',pid:42,spawn:async(event,payload)=>calls.push([event,payload.session_id]),report:()=>{}});
  binding.onEvent({event:{type:'session.status',properties:{sessionID:'child',status:{type:'busy'}}}});
  await binding.dispose();assert.deepEqual(calls.map(([event])=>event),['init','session.busy','dispose']);assert.ok(calls.every(([,id])=>id==='opencode:42'));
  assert.equal(normalizeEvent('opencode','init',JSON.stringify({session_id:calls[0][1],cwd:'/repo'})).agentId,'opencode:opencode:42');
});
test('fold reporter throw or rejection cannot escape and permission output remains unchanged',async()=>{
  for(const report of [()=>{throw new Error('broken');},async()=>{throw new Error('broken');}]) {
    const calls=[];const b=createBinding({directory:'/repo',spawn:async e=>calls.push(e),report});
    assert.doesNotThrow(()=>b.onEvent(status('s','PRIVATE')));
    const output={status:'ask'};b.onPermissionAsk({id:'p'},output);await b.dispose();
    assert.deepEqual(output,{status:'ask'});assert.deepEqual(calls,['init','permission.pending','dispose']);
  }
  for(const directory of ['', 'relative'])assert.throws(()=>createBinding({directory}),{code:'INVALID_INPUT'});
});
test('diagnostic file is private and contains codes, never raw error payloads',async t=>{
  const root=await mkdtemp(join(tmpdir(),'relay-plugin-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const stateDir=join(root,'state');const b=createBinding({directory:'/repo',env:{RELAY_STATE_DIR:stateDir},spawn:async()=>{throw new Error('PRIVATE COMMAND');}});
  await b.dispose();const log=await readFile(join(stateDir,'opencode-plugin.log'),'utf8');
  assert.match(log,/PROCESS_UNAVAILABLE/);assert.equal(log.includes('PRIVATE'),false);
  assert.equal((await stat(stateDir)).mode&0o777,0o700);assert.equal((await stat(join(stateDir,'opencode-plugin.log'))).mode&0o777,0o600);
});
test('plugin exports only the async Relay function',async()=>{
  const plugin=await import('./plugin.js');assert.deepEqual(Object.keys(plugin),['Relay']);assert.equal(plugin.Relay.constructor.name,'AsyncFunction');
});
