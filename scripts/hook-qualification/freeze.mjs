// Freeze one host's observed route and prepared synthetic fixtures for the qualification runner.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { matchSubscribers, validateSubscribers } from '../../src/subscribers.js';
import { checkRetainedWork, validateManifest, workLists } from './baseline.mjs';
import { packageFiles, packageListing } from './deployment.mjs';
import { commandWords } from './hook-settings.mjs';

const harness = 'claude-code';
const routes = new Map([
  ['Stop', { kind: 'turn-end', native: new Map([
    ['claim-guard', { args: ['--harness', harness], branches: ['claim-guard'] }],
    ['harness-state-refresh', { args: [], branches: ['harness-state-refresh'] }],
    ['turn-pause', { args: ['--harness', harness, 'Stop'], branches: ['turn-pause'] }],
  ]) }],
  ['SessionStart', { kind: 'session-start', matcher: 'startup|resume', native: new Map([
    ['claude-sessionstart', { args: [], branches: ['claude-sessionstart.halt', 'claude-sessionstart.stale', 'claude-sessionstart.index-repair'] }],
    ['claude-profile', { args: [], branches: ['claude-profile'] }],
    ['capture-notice', { args: [], branches: ['capture-notice'] }],
  ]) }],
]);

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
function requireThat(ok, message) { if (!ok) throw new Error(message); }

function settingsIdentity(options, snapshot) {
  const repo = realpathSync(options.hq);
  const git = (...args) => execFileSync('git', ['--no-optional-locks', '--literal-pathspecs', '-C', repo, ...args], {
    encoding: 'utf8', env: { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  }).trim();
  requireThat(git('rev-parse', '--show-toplevel') === repo, '--hq must name the hq checkout root');
  const frozen = options['settings-identity'] ? readJson(options['settings-identity']) : null;
  const source = options['settings-source'] ? readFileSync(options['settings-source'], 'utf8').trim() : null;
  if (source !== null) requireThat(isAbsolute(source), 'operator settings source must be an absolute path');
  const path = source === null ? frozen?.path : relative(repo, realpathSync(source));
  requireThat(typeof path === 'string' && path !== '' && path !== '.' && path === normalize(path)
    && !isAbsolute(path) && path !== '..' && !path.startsWith('../'), 'settings path must be relative to hq');
  const commit = git('rev-parse', 'HEAD');
  const blob = git('rev-parse', `${commit}:${path}`);
  requireThat(git('cat-file', '-t', blob) === 'blob', 'hq settings path must name a committed file');
  requireThat(git('status', '--porcelain', '--', path) === '', 'hq settings path is dirty');
  requireThat(git('rev-parse', 'HEAD') === commit, 'hq HEAD changed during capture');
  const settings = { repository: 'hq', commit, path, blob, liveSha256: sha(snapshot) };
  if (source !== null) return { ...settings, source };
  requireThat(Object.entries(settings).every(([key, value]) => frozen[key] === value), 'settings identity does not match the clean hq checkout and snapshot');
  return typeof frozen.from === 'string' ? { ...settings, identityFrom: frozen.from } : settings;
}

function composition(snapshot, event, route) {
  const entries = snapshot.hooks?.[event];
  requireThat(Array.isArray(entries) && entries.length, `settings have no ${event} hooks`);
  const ordered = [];
  const seen = new Set();
  let deployed;
  for (const entry of entries) {
    requireThat(entry.matcher === route.matcher && Object.keys(entry).every((key) => ['matcher', 'hooks'].includes(key))
      && Array.isArray(entry.hooks) && entry.hooks.length, `${event} matcher or hook group differs from the route map`);
    for (const hook of entry.hooks) {
      requireThat(hook.type === 'command' && typeof hook.command === 'string'
        && (hook.timeout === undefined || (Number.isFinite(hook.timeout) && hook.timeout > 0))
        && Object.keys(hook).every((key) => ['type', 'command', 'timeout'].includes(key)), `${event} handler options require a new route mapping`);
      const [program, ...args] = commandWords(hook.command);
      const name = basename(program);
      if (name === 'node') {
        const [entry, subcommand, harnessFlag, adapter, outerFlag, outer, configFlag, config, nativeEvent] = args;
        const outerMs = Number(outer);
        requireThat(!deployed && args.length === 9 && isAbsolute(entry) && basename(entry) === 'relay.js'
          && basename(dirname(entry)) === 'bin' && subcommand === 'hook' && harnessFlag === '--harness' && adapter === harness
          && outerFlag === '--outer-ms' && /^\d+$/.test(outer) && Number.isSafeInteger(outerMs) && outerMs >= 500
          && configFlag === '--subscribers' && isAbsolute(config) && nativeEvent === event, `unrecognized deployed relay ${event} command`);
        deployed = { entry, config, outerMs };
        ordered.push('deployed-relay');
      } else {
        const mapping = route.native.get(name);
        requireThat(mapping && !seen.has(name) && isDeepStrictEqual(args, mapping.args), `${event} native composition differs at ${name}`);
        seen.add(name);
        ordered.push(...mapping.branches);
      }
    }
  }
  requireThat(deployed && seen.size === route.native.size, `${event} native composition or deployed relay differs from the route map`);
  return { deployed, ordered };
}

function capturePackage(source, target) {
  const files = packageFiles(source);
  requireThat(files.includes(join('bin', 'relay.js')), 'deployed package is missing bin/relay.js');
  const listing = files.map((file) => {
    const original = join(source, file), copy = join(target, file);
    mkdirSync(dirname(copy), { recursive: true });
    copyFileSync(original, copy);
    return `${sha(readFileSync(copy))}  ${file}\n`;
  }).join('');
  const current = packageListing(source);
  requireThat(current === listing, 'the deployed package changed during capture');
  return listing;
}

// Each side of the comparison is judged by the relay that reads it: the deployed side by the bytes
// just captured (whose schema may be older than this checkout's), the candidate by this checkout.
async function deployedValidators(artifact) {
  const { validateSubscribers: validate, matchSubscribers: match } = await import(pathToFileURL(join(artifact, 'src', 'index.js')).href);
  requireThat(typeof validate === 'function' && typeof match === 'function', 'the deployed relay exports no subscriber validator');
  return { validate, match };
}

async function freeze(options) {
  const template = readJson(options.template);
  requireThat(template.schema === 1 && Array.isArray(template.manifests) && template.manifests.length === 1, 'expected a schema-1 set with one route template');
  const [manifest] = template.manifests;
  const { event } = manifest;
  const route = routes.get(event);
  requireThat(route && manifest.harness === harness && manifest.baselineKind === 'deployed-relay-plus-native'
    && manifest.schedule?.kind === 'parallel' && manifest.fixture === 'fixture', 'unsupported route template');
  const snapshot = readFileSync(options.snapshot);
  const settings = settingsIdentity(options, snapshot);
  const { deployed, ordered } = composition(JSON.parse(snapshot), event, route);
  const { outerMs } = deployed;
  const rawConfig = readFileSync(deployed.config);

  const output = resolve(options.output), artifact = join(output, 'deployed-relay');
  mkdirSync(output, { mode: 0o700 });
  try {
    const packageList = capturePackage(dirname(dirname(deployed.entry)), artifact);
    const sides = { deployed: await deployedValidators(artifact), candidate: { validate: validateSubscribers, match: matchSubscribers } };
    const selection = { kind: route.kind, nativeEvent: event, harness };
    const liveSubscribers = sides.deployed.match(sides.deployed.validate(JSON.parse(rawConfig)), selection);
    const slug = event.toLowerCase(), deployedName = `deployed-${slug}.json`;
    const configs = new Map();
    const config = (name, side) => {
      requireThat(typeof name === 'string' && /^[\w.-]+\.json$/.test(name), 'fixture config needs a JSON basename');
      if (!configs.has(name)) configs.set(name, readFileSync(join(dirname(options.template), name)));
      return sides[side].validate(JSON.parse(configs.get(name)));
    };
    const deployedFixture = config(deployedName, 'deployed');
    const candidateFixture = config(manifest.candidate.config, 'candidate');
    requireThat(sha(configs.get(manifest.candidate.config)) === manifest.candidate.configSha256, 'candidate config does not match the template digest');
    requireThat(config(manifest.noSubscriber.deployed, 'deployed').subscribers.length === 0
      && config(manifest.noSubscriber.candidate, 'candidate').subscribers.length === 0, 'no-subscriber configs must be empty');
    requireThat(!manifest.noSubscriber.speculative, `the ${event} route has no speculative no-subscriber condition`);
    const signature = (list) => list.map(({ name, role, registry }) => [name, role, registry]);
    requireThat(isDeepStrictEqual(signature(liveSubscribers), signature(deployedFixture.subscribers)), `${event} deployed subscriber composition differs from the fixture`);
    for (const [side, fixture] of [['deployed', deployedFixture], ['candidate', candidateFixture]]) {
      requireThat(sides[side].match(fixture, selection).length === fixture.subscribers.length, `fixture subscribers must all select ${event}`);
    }

    const configArg = `@CONFIG@/${deployedName}`;
    // Positional arguments preserve quoted paths after the runner substitutes its placeholders.
    const relayArgv = ['/bin/sh', '-c', '"$@"', 'relay', '@NODE@', '@DEPLOYED@', 'hook', '--harness', harness,
      '--outer-ms', String(outerMs), '--subscribers', configArg, event];
    const branches = new Map(manifest.branches.map((b) => [b.name, b]));
    requireThat(manifest.branches.length === ordered.length && branches.size === ordered.length
      && ordered.every((name) => branches.get(name)?.role === (name === 'deployed-relay' ? name : 'native')), 'template branches do not match the route map');
    manifest.branches = ordered.map((name) => name === 'deployed-relay' ? { ...branches.get(name), argv: relayArgv } : branches.get(name));
    const native = manifest.branches.filter((b) => b.role === 'native' && b.migrates !== false).map((b) => b.name);
    checkRetainedWork(manifest, workLists({ deployed: deployedFixture, candidate: candidateFixture, native }));

    const configSha256 = sha(rawConfig);
    requireThat(sha(readFileSync(deployed.config)) === configSha256, 'the deployed configuration changed during capture');
    mkdirSync(join(output, 'fixture', 'config'), { recursive: true, mode: 0o700 });
    for (const entry of ['bin', 'cwd', 'programs.json']) cpSync(join(options.fixture, entry), join(output, 'fixture', entry), { recursive: true });
    for (const [name, bytes] of configs) writeFileSync(join(output, 'fixture', 'config', name), bytes, { mode: 0o600 });
    const fileList = 'deployed-files.sha256';
    writeFileSync(join(output, fileList), packageList);
    writeFileSync(join(output, 'deployed-subscribers.json'), rawConfig, { mode: 0o600 });
    Object.assign(manifest, {
      host: hostname(), version: options.version, settings,
      inventory: { relayedEvents: [event], source: 'observed active Claude settings snapshot; this manifest covers one route' },
      deployed: { version: readJson(join(artifact, 'package.json')).version, relayEntry: join(artifact, 'bin', 'relay.js'),
        packageSha256: sha(packageList), configSha256, config: deployedName, fileList, outerMs },
    });
    validateManifest(manifest, { harness, event });
    const result = join(output, `${slug}-manifest.json`);
    const bytes = `${JSON.stringify({ schema: 1, host: manifest.host, manifests: [manifest] }, null, 2)}\n`;
    writeFileSync(result, bytes, { mode: 0o600 });
    return `${sha(bytes)}  ${result}`;
  } catch (error) {
    rmSync(output, { recursive: true, force: true });
    throw error;
  }
}

const required = ['snapshot', 'template', 'hq', 'version', 'fixture', 'output'];
const identityOptions = ['settings-identity', 'settings-source'];
try {
  const { values } = parseArgs({ options: Object.fromEntries([...required, ...identityOptions].map((key) => [key, { type: 'string' }])) });
  requireThat(required.every((key) => values[key]) && identityOptions.filter((key) => values[key]).length === 1,
    'usage: node freeze.mjs --snapshot FILE --template FILE --hq CHECKOUT --version VERSION --fixture DIR --output NEW_DIR (--settings-identity FILE | --settings-source FILE)');
  process.umask(0o077);
  console.log(await freeze(values));
} catch (error) {
  console.error(`freeze: ${error.message}`);
  process.exitCode = 1;
}
