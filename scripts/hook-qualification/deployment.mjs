// @ts-check
// Deployed relay package identity shared by manifest freezing and per-host wiring checks.
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
function requireThat(ok, message) { if (!ok) throw new Error(message); }

export function packageFiles(root) {
  const files = ['package.json'];
  for (const dir of ['bin', 'src']) {
    requireThat(lstatSync(join(root, dir)).isDirectory(), `deployed package ${dir} must be a directory`);
    for (const entry of readdirSync(join(root, dir), { recursive: true, withFileTypes: true })) {
      const file = relative(root, join(entry.parentPath, entry.name));
      requireThat(entry.isDirectory() || (entry.isFile() && !file.includes('\n')), `unsupported deployed package entry ${file}`);
      if (entry.isFile()) files.push(file);
    }
  }
  return files.sort();
}

export function packageListing(root) {
  requireThat(lstatSync(join(root, 'package.json')).isFile(), 'deployed package.json must be a regular file');
  const files = packageFiles(root);
  requireThat(files.includes(join('bin', 'relay.js')), 'deployed package is missing bin/relay.js');
  return files.map((file) => `${sha(readFileSync(join(root, file)))}  ${file}\n`).join('');
}

export const packageSha256 = (root) => sha(packageListing(root));
