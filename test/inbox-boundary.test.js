import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
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

function parseImports(sources) {
  const home = mkdtempSync(join(tmpdir(), 'relay-inbox-parser-'));
  try {
    const parsed = spawnSync(process.execPath, [fileURLToPath(new URL('./helpers/inbox-imports.js', import.meta.url))], {
      input: JSON.stringify(sources), encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024,
      env: { PATH: process.env.PATH, HOME: home, USER: 'test-user', XDG_CONFIG_HOME: join(home, 'config'),
        XDG_STATE_HOME: join(home, 'state'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
    });
    assert.ifError(parsed.error);
    assert.equal(parsed.status, 0, parsed.stderr);
    return JSON.parse(parsed.stdout);
  } finally { rmSync(home, { recursive: true, force: true }); }
}

function importViolations(file, imports, members = new Set()) {
  return imports.flatMap(({ specifier, typeOnly }) => {
    if (specifier.startsWith('node:')) return [];
    const target = relative(root, resolve(root, dirname(file), specifier));
    if (specifier.startsWith('.') && (members.has(target) || target === 'src/index.js'
      || (target === 'src/types.js' && typeOnly))) return [];
    return [`${file}: ${specifier}`];
  });
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
  const files = [...members].filter((file) => file.endsWith('.js'));
  const sources = await Promise.all(files.map((file) => readFile(resolve(root, file), 'utf8')));
  const imports = parseImports(sources);
  const failures = files.flatMap((file, i) => importViolations(file, imports[i], members));
  assert.deepEqual(failures, [], `inbox imports leave its boundary:\n${failures.join('\n')}`);
});


const cases = [
  ['private import after URL', "const endpoint = 'https://example.invalid'; import { relayError } from '../protocol.js';", ['src/routes/probe.js: ../protocol.js']],
  ['commented dynamic argument', "await import(/* lazy-load private module */ '../protocol.js');", ['src/routes/probe.js: ../protocol.js']],
  ['URL and actual comments', "const endpoint = 'https://example.invalid'; // import('../protocol.js')\n/* export { x } from '../protocol.js'; */", []],
  ['ordinary quoted import text', `const text = "import('../protocol.js')";`, []],
  ['template import text', "const text = `import('../protocol.js')`;", []],
  ['template interpolation import', "const text = `before ${import('../protocol.js')} after`;", ['src/routes/probe.js: ../protocol.js']],
  ['import after interpolated template', "const text = `before ${1} after`; import('../protocol.js');", ['src/routes/probe.js: ../protocol.js']],
  ['import method property', "await loader.import('../protocol.js');", []],
  ['regular expression import text', "const pattern = /import('private-package')/;", []],
  ['private re-export', "export { relayError } from '../protocol.js';", ['src/routes/probe.js: ../protocol.js']],
  ['bare dependency', "import x from 'private-package';", ['src/routes/probe.js: private-package']],
  ['JSDoc type import', "/** @type {import('../types.js').Handle} */ const handle = null;", []],
  ['runtime import with JSDoc', "/** @type {any} */ const value = import('../types.js');", ['src/routes/probe.js: ../types.js']],
  ['runtime type import', "await import('../types.js');", ['src/routes/probe.js: ../types.js']],
  ['public and builtin imports', "import { paths } from '../index.js'; export { readFile } from 'node:fs';", []],
];
const caseImports = parseImports(cases.map(([, source]) => source));
for (const [i, [name, , expected]] of cases.entries()) {
  test(`boundary scanner: ${name}`, () => {
    assert.deepEqual(importViolations('src/routes/probe.js', caseImports[i]), expected);
  });
}
