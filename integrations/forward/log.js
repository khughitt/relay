import { join } from 'node:path';
import { appendFile } from 'node:fs/promises';
import { paths } from '../../src/bus/paths.js';
import { ensurePrivateDir, checkPrivate } from '../../src/bus/store.js';

// Diagnostics never inherit the harness's stderr, which a TUI renders into. Callers supply only
// sanitized codes.
export async function logError(file, message, env = process.env) {
  const { stateDir } = paths(env), path = join(stateDir, file);
  await ensurePrivateDir(stateDir);
  await checkPrivate(path, false);
  await appendFile(path, `${new Date().toISOString()} ${message}\n`, { mode: 0o600 });
}
