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
import * as qualification from 'relay/qualification';

const EXPORTS = ['STATES', 'paths', 'adapterFor', 'normalizeEvent', 'normalizeHookEvent', 'registryEventFor', 'projectEnvelope', 'readNativeInput', 'createProcessOps', 'readSnapshot', 'readSnapshotFor', 'listAgents',
  'applyEvent', 'reapRegistry', 'CONTEXT_LIMIT', 'parseReply', 'validateSubscribers', 'loadSubscribers', 'matchSubscribers', 'budgetFor',
  'checkBudget', 'dispatchHook', 'reconcile', 'withLock', 'validateHandle', 'parsePayload', 'whoami'].sort();
assert.deepEqual(Object.keys(relay).sort(), EXPORTS);
const packageRoot = new URL('../', import.meta.resolve('relay'));
const messageSchema = JSON.parse(await readFile(new URL('schemas/interaction/message.schema.json', packageRoot), 'utf8'));
assert.equal(messageSchema.$schema, 'https://json-schema.org/draft/2020-12/schema');
for (const docPath of [
  'docs/api.md',
  'docs/registry.md',
  'docs/adapters.md',
  'docs/questions.md',
  'docs/runbooks/inbox-service.md',
  'docs/runbooks/registry-lock-repair.md',
  'docs/evidence/codex-question-0.166.0.json',
]) {
  assert.ok((await readFile(new URL(docPath, packageRoot), 'utf8')).length > 0, docPath);
}
assert.deepEqual(Object.keys(plugin), ['Relay']); assert.equal(plugin.Relay.constructor.name, 'AsyncFunction');
const corpus = JSON.parse(await readFile(new URL(import.meta.resolve('relay/fixtures/handles.json')), 'utf8'));
assert.equal(corpus.schema, 1); assert.ok(corpus.starts.some(c => c.expected === '9007199254740993'));
const chains = JSON.parse(await readFile(new URL(import.meta.resolve('relay/fixtures/ancestry.json')), 'utf8'));
assert.equal(chains.schema, 1); assert.ok(chains.chains.some(c => c.name === 'background-under-systemd'));
const identities = JSON.parse(await readFile(new URL(import.meta.resolve('relay/fixtures/whoami.json')), 'utf8'));
assert.ok(Array.isArray(identities)); assert.ok(identities.some(item => item.expect?.status === 'resolved'));
// The HookQualification validator and its fixture contract, for a settings generator outside relay.
assert.deepEqual(Object.keys(qualification).sort(), ['QUALIFICATION_CHECKS', 'QUALIFICATION_ROLES', 'QUALIFICATION_STATUSES', 'applicableChecks',
  'parseQualification', 'qualificationRows', 'qualifyBinding', 'qualifyInstall', 'requiredRoutes']);
const contract = qualification.parseQualification(await readFile(new URL(import.meta.resolve('relay/fixtures/hook-qualification.json')), 'utf8'));
assert.equal(contract.schema, 1); assert.ok(contract.rows.length > 0);
assert.deepEqual(await relay.listAgents(), { snapshot: null, liveness: {} });

const bin = fileURLToPath(new URL('node_modules/.bin/relay', import.meta.url));
const cliEnv = { PATH: process.env.PATH, HOME: process.env.HOME, RELAY_STATE_DIR: process.env.RELAY_STATE_DIR,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const cli = (args) => execFileSync(bin, args, { env: cliEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
assert.equal(cli(['list', '--json']), '{"snapshot":null,"liveness":{}}\n');
assert.match(cli(['--help']), /^Usage: relay /);

// The install path is the one that loads relay's runtime dependency. Plan mode writes nothing.
const scratch = mkdtempSync(join(tmpdir(), 'relay-smoke-'));
try {
  const subscribers = join(scratch, 'subscribers.json'), hooks = join(scratch, 'hooks.json');
  writeFileSync(subscribers, '{"schema":2,"subscribers":[]}\n', { mode: 0o600 });
  writeFileSync(hooks, '{"hooks":{}}\n');
  // Without route qualification the planner refuses; a tarball install records no commit to bind one to.
  assert.throws(() => cli(['install', '--harness', 'codex', '--subscribers', subscribers, '--target', hooks]), (error) => /UNQUALIFIED_ROUTE: .*--qualification/.test(error.stderr));
  assert.equal(cli(['pairs', '--harness', 'codex', '--target', hooks]), '[]\n');
  assert.equal(readFileSync(hooks, 'utf8'), '{"hooks":{}}\n');
} finally { rmSync(scratch, { recursive: true, force: true }); }
console.log('installed package verified');
