import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { bindingsFor, planHooks, shellQuote, timeoutSeconds, versionManagerOf, versionWarnings } from '../src/install/hooks.js';
import { planClaudeCode } from '../src/install/claude-code.js';
import { planCodex } from '../src/install/codex.js';
import { tempState } from './helpers/fixture.js';

const relay = '/opt/relay/bin/relay';
const subscribers = '/home/me/.config/relay/subscribers.json';
const node = shellQuote(process.execPath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const base = '{\n  // keep this comment\n  "hooks": {\n    "SessionStart": [{"hooks":[{"type":"command","command":"/home/me/familiar/bin/familiar hook --agent codex SessionStart"}]}],\n    "PreToolUse": [{"matcher":"*","hooks":[{"type":"command","command":"\'/old relay/bin/relay\' hook --harness codex --outer-ms 30000 PreToolUse"}]}]\n  },\n  "statusLine": {"type":"command","command":"ops"}\n}';

test('planner replaces stale relay hooks, retires both familiar shapes, and preserves JSONC', () => {
  assert.throws(() => planHooks({ text: base, harness: 'codex', relayBin: relay, subscribersPath: subscribers }), /familiar/);
  const text = planHooks({ text: base, harness: 'codex', relayBin: relay, subscribersPath: subscribers, retireFamiliar: true });
  assert.match(text, /keep this comment/); assert.match(text, /"statusLine": \{"type":"command","command":"ops"\}/);
  assert.match(text, new RegExp(shellQuote(relay).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(text, /--outer-ms 600000 --subscribers '\/home\/me\/\.config\/relay\/subscribers\.json' PreToolUse/);
  assert.equal(text.includes('familiar hook'), false);
});

test('planner rejects duplicate relay writers and recognizes quoted trailing familiar agent', () => {
  const text = '{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"\'/x/familiar\' hook SessionStart --agent codex"}]},{"hooks":[{"type":"command","command":"\'/a/relay\' hook --harness codex SessionStart"}]},{"hooks":[{"type":"command","command":"\'/b/relay\' hook --harness codex --outer-ms 1000 SessionStart"}]}]}}';
  assert.throws(() => planHooks({ text, harness: 'codex', relayBin: relay, subscribersPath: subscribers, retireFamiliar: true }), /duplicate relay/);
});

test('Claude retains both Notification matchers', () => {
  const text = planHooks({ text: '{"hooks":{}}', harness: 'claude-code', relayBin: relay, subscribersPath: subscribers });
  const notifications = JSON.parse(text).hooks.Notification;
  assert.deepEqual(notifications.map(entry => entry.matcher), ['idle_prompt', 'permission_prompt']);
});

test('every installed relay entry carries the explicit outer timeout in whole seconds', () => {
  for (const harness of ['claude-code', 'codex']) {
    const hooks = JSON.parse(planHooks({ text: '{"hooks":{}}', harness, relayBin: relay, subscribersPath: subscribers })).hooks;
    for (const [key, entries] of Object.entries(hooks)) for (const entry of entries) {
      const [hook] = entry.hooks;
      const outerMs = Number(hook.command.match(/--outer-ms (\d+) /)[1]);
      assert.equal(hook.timeout, outerMs / 1000, `${harness} ${key}`);
      assert.deepEqual(Object.keys(hook), ['type', 'command', 'timeout']);
    }
    assert.equal(hooks.SessionEnd[0].hooks[0].timeout, harness === 'codex' ? 3 : 60);
    assert.equal(hooks.PreToolUse[0].hooks[0].timeout, 600);
  }
});

test('planner replaces a relay entry whose timeout drifted from its command', () => {
  const text = '{"hooks":{"PreToolUse":[{"matcher":"*","hooks":[{"type":"command","command":"\'/x/relay\' hook --harness codex --outer-ms 600000 PreToolUse","timeout":30}]}]}}';
  const [entry] = JSON.parse(planHooks({ text, harness: 'codex', relayBin: relay, subscribersPath: subscribers })).hooks.PreToolUse;
  assert.equal(entry.hooks[0].timeout, 600);
  assert.match(entry.hooks[0].command, /--outer-ms 600000 --subscribers '[^']*' PreToolUse$/);
});

test('an installed timeout is the outer budget in positive whole seconds', () => {
  assert.equal(timeoutSeconds(3000), 3);
  for (const bad of [2500, 0, -1000, 1000.5, '1000']) assert.throws(() => timeoutSeconds(bad), /whole seconds/);
});

test('every relay entry names the subscriber file after the outer budget', () => {
  for (const harness of ['claude-code', 'codex']) {
    const hooks = JSON.parse(planHooks({ text: '{"hooks":{}}', harness, relayBin: relay, subscribersPath: subscribers })).hooks;
    for (const entries of Object.values(hooks)) for (const entry of entries) {
      assert.match(entry.hooks[0].command, new RegExp(`^${node} '/opt/relay/bin/relay' hook --harness ${harness} --outer-ms \\d+ --subscribers '/home/me/\\.config/relay/subscribers\\.json' \\S+$`));
    }
  }
  assert.throws(() => planHooks({ text: '{"hooks":{}}', harness: 'codex', relayBin: relay, subscribersPath: 'relative.json' }), /absolute/);
  assert.throws(() => planHooks({ text: '{"hooks":{}}', harness: 'codex', relayBin: relay }), /absolute/);
});

test('relay entries from before the flag, and with it, are owned and replaced', () => {
  const text = '{"hooks":{"PreToolUse":[{"matcher":"*","hooks":[{"type":"command","command":"/x/relay hook --harness codex PreToolUse"}]}],"Stop":[{"hooks":[{"type":"command","command":"\'/x/relay\' hook --harness codex --outer-ms 600000 --subscribers \'/old/subscribers.json\' Stop","timeout":600}]}]}}';
  const hooks = JSON.parse(planHooks({ text, harness: 'codex', relayBin: relay, subscribersPath: subscribers })).hooks;
  assert.equal(hooks.PreToolUse.length, 1); assert.match(hooks.PreToolUse[0].hooks[0].command, /--subscribers '\/home\/me\/\.config\/relay\/subscribers\.json' PreToolUse$/);
  assert.equal(hooks.Stop.length, 1); assert.match(hooks.Stop[0].hooks[0].command, /--subscribers '\/home\/me\/\.config\/relay\/subscribers\.json' Stop$/);
});

test('a second install recognizes its own entries when the paths contain apostrophes', () => {
  const quirky = "/tmp/team's config/subscribers.json", bin = "/opt/o'relay/bin/relay";
  const once = planHooks({ text: '{"hooks":{}}', harness: 'codex', relayBin: bin, subscribersPath: quirky });
  assert.match(JSON.parse(once).hooks.PreToolUse[0].hooks[0].command, /--subscribers '\/tmp\/team'\\''s config\/subscribers\.json' PreToolUse/);
  const twice = planHooks({ text: once, harness: 'codex', relayBin: bin, subscribersPath: quirky });
  assert.equal(twice, once);
  for (const entries of Object.values(JSON.parse(twice).hooks)) assert.equal(entries.length, 1);
  const moved = JSON.parse(planHooks({ text: once, harness: 'codex', relayBin: relay, subscribersPath: subscribers })).hooks;
  assert.equal(moved.PreToolUse.length, 1); assert.match(moved.PreToolUse[0].hooks[0].command, new RegExp(`^${node} '/opt/relay/bin/relay' hook`));
});

test('every relay entry runs relay.js with the installer\'s node, and older entries are replaced', () => {
  const custom = "/opt/o'node/bin/node", quoted = shellQuote(custom).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const harness of ['claude-code', 'codex']) {
    const hooks = JSON.parse(planHooks({ text: '{"hooks":{}}', harness, relayBin: relay, subscribersPath: subscribers, nodeBin: custom })).hooks;
    for (const entries of Object.values(hooks)) for (const entry of entries) assert.match(entry.hooks[0].command, new RegExp(`^${quoted} '/opt/relay/bin/relay' hook --harness ${harness} `));
  }
  // An entry written before the node path, relay.js alone, is relay's own and is replaced.
  const legacy = `{"hooks":{"PreToolUse":[{"matcher":"*","hooks":[{"type":"command","command":"'/x/relay' hook --harness codex --outer-ms 600000 --subscribers '/old/subscribers.json' PreToolUse","timeout":600}]}]}}`;
  const [entry, ...rest] = JSON.parse(planHooks({ text: legacy, harness: 'codex', relayBin: relay, subscribersPath: subscribers })).hooks.PreToolUse;
  assert.deepEqual(rest, []); assert.match(entry.hooks[0].command, new RegExp(`^${node} '/opt/relay/bin/relay' hook --harness codex `));
  const once = planHooks({ text: '{"hooks":{}}', harness: 'codex', relayBin: relay, subscribersPath: subscribers, nodeBin: custom });
  assert.equal(planHooks({ text: once, harness: 'codex', relayBin: relay, subscribersPath: subscribers, nodeBin: custom }), once);
  assert.throws(() => planHooks({ text: '{"hooks":{}}', harness: 'codex', relayBin: relay, subscribersPath: subscribers, nodeBin: 'node' }), /node path must be absolute/);
  const args = { text: '{"hooks":{}}', relayBin: relay, nodeBin: custom, subscribersPath: subscribers, subscribers: { subscribers: [] } };
  const preToolUse = (artifact) => JSON.parse(artifact.changes[0].after).hooks.PreToolUse[0].hooks[0].command;
  assert.match(preToolUse(planClaudeCode({ ...args, target: '/checkout/ai/claude/settings.json' })), new RegExp(`^${quoted} `));
  assert.match(preToolUse(planCodex({ ...args, target: '/checkout/ai/codex/hooks.json' })), new RegExp(`^${quoted} `));
  for (const plan of [planClaudeCode, planCodex]) assert.throws(() => plan({ ...args, nodeBin: 'node', target: '/checkout/ai/codex/hooks.json' }), /node path/);
});

// A harness started from the macOS GUI inherits launchd's PATH, which has no nvm or Homebrew node.
test('a rendered hook command runs under launchd\'s minimal PATH', async (t) => {
  const p = await tempState(t), dir = join(p.stateDir, 'config'), file = join(dir, 'subscribers.json');
  await mkdir(dir, { mode: 0o700 });
  const guard = { name: 'g', role: 'guard', kinds: ['before-tool'], harnesses: ['claude-code', 'codex'], argv: [process.execPath, new URL('./fixtures/subscriber.js', import.meta.url).pathname, 'deny'], timeoutMs: 2000 };
  await writeFile(file, JSON.stringify({ schema: 1, subscribers: [guard] }), { mode: 0o600 });
  const relayBin = realpathSync(new URL('../bin/relay.js', import.meta.url).pathname), minimal = '/usr/bin:/bin:/usr/sbin:/sbin';
  const run = (command, searchPath = minimal) => spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8', timeout: 20000,
    env: { PATH: searchPath, HOME: p.stateDir, RELAY_STATE_DIR: join(p.stateDir, 'state') },
    input: JSON.stringify({ session_id: 'minimal-path', cwd: p.stateDir, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'true' } }) });
  for (const harness of ['claude-code', 'codex']) {
    const [entry] = JSON.parse(planHooks({ text: '{}', harness, relayBin, subscribersPath: file })).hooks.PreToolUse;
    const r = run(entry.hooks[0].command);
    assert.equal(r.status, 2, `${harness}: ${r.stderr}`); assert.match(r.stdout, /"permissionDecision":"deny"/);
  }
  // The command without the node path is what failed: `env: node: No such file or directory`.
  const [entry] = JSON.parse(planHooks({ text: '{}', harness: 'claude-code', relayBin, subscribersPath: file })).hooks.PreToolUse;
  const r = run(entry.hooks[0].command.slice(shellQuote(process.execPath).length + 1), '');
  assert.equal(r.status, 127, r.stderr); assert.match(r.stderr, /node.*No such file or directory/);
});

// A path inside one version's directory dies with that version; Node reports the resolved
// binary, so a stable shim in front of it is not what an install would write.
test('a node or relay path under a version manager\'s per-version directory is recognized', () => {
  const versioned = [
    ['/home/u/.nvm/versions/node/v26.5.0/bin/node', 'nvm or n'],
    ['/home/u/.nvm/versions/node/v26.5.0/lib/node_modules/relay/bin/relay.js', 'nvm or n'],
    ['/home/u/.local/share/fnm/node-versions/v22.23.2/installation/bin/node', 'fnm'],
    ['/usr/local/n/versions/node/22.23.2/bin/node', 'nvm or n'],
    ['/run/user/1000/fnm_multishells/4242_1760000000000/bin/node', "fnm's per-shell link"],
    ['/home/u/.nodenv/versions/22.23.2/bin/node', 'nodenv'],
    ['/home/u/.volta/tools/image/node/22.23.2/bin/node', 'Volta'],
    ['/opt/volta-home/tools/image/node/22.23.2/bin/node', 'Volta'],
    ['/home/u/.asdf/installs/nodejs/22.23.2/bin/node', 'asdf or mise'],
    ['/home/u/.local/share/mise/installs/node/22.23.2/bin/node', 'asdf or mise'],
    ['/opt/homebrew/Cellar/node/26.5.0/bin/node', 'Homebrew'],
    ['/usr/local/Cellar/node@22/22.23.2/bin/node', 'Homebrew'],
  ];
  for (const [path, manager] of versioned) assert.equal(versionManagerOf(path), manager, path);
  for (const path of ['/usr/bin/node', '/usr/local/bin/node', '/opt/homebrew/bin/node', '/home/u/.volta/bin/node', '/opt/relay/bin/relay.js', '/home/u/src/versions/relay/bin/relay.js']) {
    assert.equal(versionManagerOf(path), null, path);
  }
});

test('install warnings name each versioned path, its failure mode and its remedy', () => {
  const nvm = '/home/u/.nvm/versions/node/v26.5.0';
  assert.deepEqual(versionWarnings({ nodeBin: '/usr/bin/node', relayBin: '/opt/relay/bin/relay.js' }), []);
  const [node, relayWarning, ...rest] = versionWarnings({ nodeBin: `${nvm}/bin/node`, relayBin: `${nvm}/lib/node_modules/relay/bin/relay.js` });
  assert.deepEqual(rest, []);
  assert.match(node, new RegExp(`^node path ${nvm}/bin/node is managed by nvm or n; .*stop running, silently, when that version is removed.*--node`));
  assert.match(relayWarning, new RegExp(`^relay path ${nvm}/lib/node_modules/relay/bin/relay.js is managed by nvm or n; .*stop running, silently, when that version is removed`));
  assert.doesNotMatch(relayWarning, /--node/);
  const [only, ...none] = versionWarnings({ nodeBin: '/usr/bin/node', relayBin: '/usr/local/Cellar/relay/0.1.0/libexec/bin/relay.js' });
  assert.deepEqual(none, []); assert.match(only, /^relay path .* is managed by Homebrew;/);
  const [shell] = versionWarnings({ nodeBin: '/run/user/1000/fnm_multishells/4242_1760000000000/bin/node', relayBin: '/opt/relay/bin/relay.js' });
  assert.match(shell, /is managed by fnm's per-shell link; .*stop running, silently, when that shell's session ends/);
});
test('Codex binds the worker lifecycle with the default budget and no matcher', () => {
  assert.deepEqual(bindingsFor('codex').map(binding => binding.event),
    ['SessionStart', 'SubagentStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'Stop', 'SubagentStop', 'SessionEnd']);
  const hooks = JSON.parse(planHooks({ text: '{"hooks":{}}', harness: 'codex', relayBin: relay, subscribersPath: subscribers })).hooks;
  for (const event of ['SubagentStart', 'SubagentStop']) {
    const [entry] = hooks[event];
    assert.equal(Object.hasOwn(entry, 'matcher'), false, event);
    assert.match(entry.hooks[0].command, new RegExp(` hook --harness codex --outer-ms 600000 --subscribers \\S+ ${event}$`), event);
    assert.equal(entry.hooks[0].timeout, 600, event);
  }
});
