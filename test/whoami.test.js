import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paths } from '../src/bus/paths.js';
import { readFileSync } from 'node:fs';
import { whoami, printable } from '../src/identity/whoami.js';
import { whoamiCase } from './helpers/whoami-cases.js';
import { tasksProofOnly, tasksClaimSession } from './helpers/tasks-consumer.js';

const cases = JSON.parse(readFileSync(new URL('./fixtures/whoami.json', import.meta.url), 'utf8'));
for (const item of cases) test(item.name, async () => {
  const fixture = whoamiCase(item.inputs);
  if (item.expect.failed) {
    await assert.rejects(whoami(fixture.options), error => {
      assert.equal(error.code, item.expect.failed);
      assert.deepEqual(error.native, item.evidence.native);
      assert.equal(error.nativeSource, item.evidence.nativeSource);
      assert.equal(error.nativeSession, item.evidence.nativeSession);
      assert.doesNotMatch(error.message, /\p{Cc}/u);
      return true;
    });
  } else {
    const result = await whoami(fixture.options);
    assert.deepEqual(result, item.expect);
    if (result.message) assert.doesNotMatch(result.message, /\p{Cc}/u);
    if (item.tasks?.claim) assert.equal(tasksProofOnly(result, item.tasks.claim), item.tasks.proofOnly === 'accept');
    if (item.tasks && Object.hasOwn(item.tasks, 'claimSession')) assert.equal(tasksClaimSession(result), item.tasks.claimSession);
  }
  assert.equal(fixture.registryCalls(), item.registryCalls);
});

test('registry not opened early', async () => {
  for (const item of cases.filter(item => item.registryCalls === 0)) {
    let calls = 0;
    const { options } = whoamiCase(item.inputs);
    options.readRegistry = async () => { calls++; throw new Error('must not open registry'); };
    try { await whoami(options); } catch (error) { assert.equal(error.code, item.expect.failed); }
    assert.equal(calls, 0, item.name);
  }
});

test('printable preserves ordinary fields and replaces entire control-bearing fields', () => {
  assert.equal(printable('claude-code:c1'), 'claude-code:c1');
  assert.equal(printable('claude-code:c1\tx'), '[control characters]');
  assert.equal(printable('project\u0085name'), '[control characters]');
});

test('tasks proof-only requires every claim handle component and a session boundary', async () => {
  const item = cases.find(item => item.name === 'proof-only Codex thread matching');
  const result = await whoami(whoamiCase(item.inputs).options);
  const claim = item.tasks.claim;
  for (const change of [{pid:43}, {pid:null}, {pidStart:'901'}, {pidStart:null},
    {host:'another-host'}, {bootId:null}, {bootId:'22222222-2222-4222-8222-222222222222'}]) {
    assert.equal(tasksProofOnly(result, {...claim,...change}), false);
  }
  for (const name of ['outside to init', 'daemon hosting process', 'hidden namespace', 'Darwin resolves with decoded evidence']) {
    const fixture = cases.find(item => item.name === name);
    assert.equal(tasksProofOnly(await whoami(whoamiCase(fixture.inputs).options), claim), false, name);
  }
});

test('tasks accepts only the known session representations', async () => {
  const item = cases.find(item => item.name === 'proof-only Claude matching');
  const result = await whoami(whoamiCase(item.inputs).options);
  for (const session of ['c1','claude:c1','claude-code:c1']) {
    assert.equal(tasksProofOnly(result, {...item.tasks.claim,session}), true);
  }
  for (const session of ['agy:c1','codex:c1','sid:4242','claude-code:other']) {
    assert.equal(tasksProofOnly(result, {...item.tasks.claim,session}), false);
  }
});

test('a no-match diagnostic uses the established boundary without another process read', async () => {
  const item = cases.find(item => item.name === 'empty registry');
  const { options } = whoamiCase(item.inputs);
  const recordOf = options.processOps.recordOf;
  const seen = new Set();
  options.processOps.recordOf = pid => {
    assert.equal(seen.has(pid), false, 'a second read can race with process exit');
    seen.add(pid);
    return recordOf(pid);
  };
  assert.deepEqual(await whoami(options), item.expect);
});


test('default registry reads honor the caller clock and absolute deadline', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'relay-whoami-clock-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const { options } = whoamiCase(cases.find(item => item.name === 'empty registry').inputs);
  delete options.readRegistry;
  options.paths = paths({ HOME: temp, RELAY_STATE_DIR: join(temp, 'state') });
  let calls = 0;
  options.clock = () => { calls++; return 100; };
  assert.equal((await whoami(options)).code, 'NOT_REGISTERED');
  assert.equal(calls, 1, 'registry derives its default deadline from the caller clock');
  options.deadline = 200;
  assert.equal((await whoami(options)).code, 'NOT_REGISTERED');
  assert.equal(calls, 1, 'an absolute caller deadline needs no new default');
});
