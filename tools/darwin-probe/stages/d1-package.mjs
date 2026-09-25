import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const EXPORTS = ['STATES', 'paths', 'adapterFor', 'normalizeEvent', 'readNativeInput', 'createProcessOps', 'readSnapshot', 'listAgents',
  'applyEvent', 'reapRegistry', 'CONTEXT_LIMIT', 'parseReply', 'validateSubscribers', 'loadSubscribers', 'matchSubscribers', 'budgetFor',
  'checkBudget', 'dispatchHook', 'reconcile'];
export async function run(ctx) {
  const consumer = join(ctx.root, 'consumer'), cache = join(ctx.root, 'npm-cache'), state = join(ctx.root, 'd1-state');
  mkdirSync(consumer); mkdirSync(state, { mode: 0o700 });
  writeFileSync(join(consumer, 'package.json'), '{"name":"consumer","private":true,"type":"module"}\n');
  const install = await ctx.t.run('npm', ['install', '--offline', '--no-audit', '--no-fund', '--cache', cache, ctx.tarball], { cwd: consumer, env: ctx.env });
  ctx.log(`npm install: ${install.exit}\n${install.stderr}`);
  const bin = join(consumer, 'node_modules/.bin/relay');
  const help = await ctx.t.run(bin, ['--help'], { env: ctx.env });
  const list = await ctx.t.run(bin, ['list', '--json'], { env: { ...ctx.env, RELAY_STATE_DIR: state } });
  const entry = join(consumer, 'node_modules/relay');
  const mod = await import(pathToFileURL(join(entry, 'src/index.js')).href).catch(() => ({}));
  const exports = Object.fromEntries(EXPORTS.map((n) => [n, mod[n] !== undefined]));
  const probe = async (specifier, options) => { try { await import(specifier, options); return true; } catch (error) { ctx.log(`${specifier}: ${error.message}`); return false; } };
  const req = (sub) => pathToFileURL(join(entry, sub)).href;
  const subpaths = { opencode: await probe(req('integrations/opencode/plugin.js')),
    handles: await probe(req('test/fixtures/handles.json'), { with: { type: 'json' } }),
    ancestry: await probe(req('test/fixtures/ancestry.json'), { with: { type: 'json' } }) };
  ctx.consumer = consumer;
  let json = null; try { json = JSON.parse(list.stdout); } catch {}
  return { status: 'ran', observations: { install: { exit: install.exit }, help: { exit: help.exit }, list: { exit: list.exit, json }, exports, subpaths } };
}
