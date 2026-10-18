// The installed-package smoke. Copy it into a consumer directory whose node_modules/relay is the
// package under test and run it there: run in place, 'relay' would resolve to this checkout.
// The caller supplies RELAY_STATE_DIR (absent or 0700) and XDG_CONFIG_HOME in scratch space.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as relay from 'relay';
import * as plugin from 'relay/opencode';

const EXPORTS = ['STATES', 'paths', 'adapterFor', 'normalizeEvent', 'readNativeInput', 'createProcessOps', 'readSnapshot', 'listAgents',
  'applyEvent', 'reapRegistry', 'CONTEXT_LIMIT', 'parseReply', 'validateSubscribers', 'loadSubscribers', 'matchSubscribers', 'budgetFor',
  'checkBudget', 'dispatchHook', 'reconcile'].sort();
assert.deepEqual(Object.keys(relay).sort(), EXPORTS);
const packageRoot = new URL('../', import.meta.resolve('relay'));
const messageSchema = JSON.parse(await readFile(new URL('schemas/interaction/message.schema.json', packageRoot), 'utf8'));
assert.equal(messageSchema.$schema, 'https://json-schema.org/draft/2020-12/schema');
assert.ok((await readFile(new URL('docs/runbooks/inbox-service.md', packageRoot), 'utf8')).length > 0);
assert.deepEqual(Object.keys(plugin), ['Relay']); assert.equal(plugin.Relay.constructor.name, 'AsyncFunction');
const corpus = JSON.parse(await readFile(new URL(import.meta.resolve('relay/fixtures/handles.json')), 'utf8'));
assert.equal(corpus.schema, 1); assert.ok(corpus.starts.some(c => c.expected === '9007199254740993'));
const chains = JSON.parse(await readFile(new URL(import.meta.resolve('relay/fixtures/ancestry.json')), 'utf8'));
assert.equal(chains.schema, 1); assert.ok(chains.chains.some(c => c.name === 'background-under-systemd'));
assert.deepEqual(await relay.listAgents(), { snapshot: null, liveness: {} });

const bin = fileURLToPath(new URL('node_modules/.bin/relay', import.meta.url));
const cli = (args) => execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
assert.equal(cli(['list', '--json']), '{"snapshot":null,"liveness":{}}\n');
assert.match(cli(['--help']), /^Usage: relay /);

// The install path is the one that loads relay's runtime dependency. Plan mode writes nothing.
const scratch = mkdtempSync(join(tmpdir(), 'relay-smoke-'));
try {
  const subscribers = join(scratch, 'subscribers.json'), hooks = join(scratch, 'hooks.json');
  writeFileSync(subscribers, '{"schema":1,"subscribers":[]}\n', { mode: 0o600 });
  writeFileSync(hooks, '{"hooks":{}}\n');
  const plan = cli(['install', '--harness', 'codex', '--subscribers', subscribers, '--target', hooks]);
  assert.equal(typeof JSON.parse(plan), 'object');
  assert.equal(readFileSync(hooks, 'utf8'), '{"hooks":{}}\n');
} finally { rmSync(scratch, { recursive: true, force: true }); }
console.log('installed package verified');
