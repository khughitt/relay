import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const INBOX_SET = [
  'src/serve/**', 'src/interaction/**', 'src/routes/**', 'src/cli/desk.js',
  ...['cli-desk', 'cli-interaction', 'codex-composition', 'codex-connector',
    'codex-delivery-integration', 'codex-delivery', 'codex-evidence', 'codex-identity',
    'codex-inbox', 'codex-public', 'codex-receipts', 'codex-record', 'codex-recovery',
    'codex-rpc', 'codex-service', 'codex-transport', 'interaction-lifecycle',
    'interaction-message', 'interaction-store', 'routes-ask', 'routes-claude-code',
    'routes-codex', 'serve-http', 'serve-inbox', 'serve-process', 'serve-socket-path',
    'serve-socket'].map((name) => `test/${name}.test.js`),
  ...['ask-hook', 'codex-recovery-worker', 'serve-worker', 'socket-waiter']
    .map((name) => `test/fixtures/${name}.js`),
  'test/fixtures/claude-askuserquestion-post.json',
  ...['fixture', 'interaction', 'spawn-lines', 'wait', 'cli-interaction',
    'codex-question', 'codex-server', 'codex-wire', 'codex-store']
    .map((name) => `test/helpers/${name}.js`),
];
const root = fileURLToPath(new URL('../', import.meta.url));

async function filesIn(directory) {
  const entries = await readdir(resolve(root, directory), { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory()
    ? filesIn(join(directory, entry.name)) : join(directory, entry.name)))).flat();
}

test('the inbox and its moving tests use only the public relay boundary', async () => {
  const members = new Set();
  for (const path of INBOX_SET) {
    if (path.endsWith('/**')) {
      const files = await filesIn(path.slice(0, -3));
      assert.ok(files.length, `${path} must contain files`);
      for (const file of files) members.add(file);
    } else {
      assert.ok((await stat(resolve(root, path))).isFile(), `${path} must exist`);
      members.add(path);
    }
  }
  const failures = [];
  for (const file of members) {
    if (!file.endsWith('.js')) continue;
    const source = await readFile(resolve(root, file), 'utf8');
    const comments = [...source.matchAll(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g)];
    const imports = /\b(?:import|export)\s+(?:[^;'"]*?\s+from\s*)?(['"])([^'"]+)\1|\bimport\s*\(\s*(['"])([^'"]+)\3\s*\)/g;
    for (const match of source.matchAll(imports)) {
      const specifier = match[2] ?? match[4];
      const comment = comments.find((c) => match.index >= c.index && match.index < c.index + c[0].length);
      if (comment && !comment[0].startsWith('/**')) continue;
      if (specifier.startsWith('node:')) continue;
      const target = relative(root, resolve(root, dirname(file), specifier));
      if (specifier.startsWith('.') && (members.has(target) || target === 'src/index.js'
        || (target === 'src/types.js' && comment?.[0].startsWith('/**')))) continue;
      failures.push(`${file}: ${specifier}`);
    }
  }
  assert.deepEqual(failures, [], `inbox imports leave its boundary:\n${failures.join('\n')}`);
});
