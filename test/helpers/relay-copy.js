// A separately versioned relay installation laid out as npm installs one from git: the package
// under <prefix>/node_modules/relay and, when a commit is given, the hidden lock entry naming it.
import { cp, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;

/** @param {string} prefix @param {string|null} commit @returns {Promise<string>} the copy's bin/relay.js */
export async function relayCopy(prefix, commit) {
  const pkg = join(prefix, 'node_modules', 'relay');
  for (const part of ['bin', 'src', 'package.json']) await cp(join(ROOT, part), join(pkg, part), { recursive: true });
  await symlink(join(ROOT, 'node_modules', 'jsonc-parser'), join(prefix, 'node_modules', 'jsonc-parser'));
  if (commit) await writeFile(join(prefix, 'node_modules', '.package-lock.json'), JSON.stringify({ name: 'host', lockfileVersion: 3,
    packages: { 'node_modules/relay': { version: '0.4.0', resolved: `git+https://example.invalid/relay.git#${commit}` } } }));
  return join(pkg, 'bin', 'relay.js');
}
