// @ts-check
// The candidate's side of a route: its frozen configuration is a template whose search path names
// the runner's own directories, so one digest serves every host, and a run credits only the program
// the candidate's resolver selects from the configuration rendered for that host.
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

/** The PATH a candidate hook is launched with: no fixture program is on it, so a candidate that
 * still looks there finds nothing. */
export const CANDIDATE_HOOK_PATH = '/usr/bin:/bin';

/**
 * The configuration one host measures. Only a searchPath entry that is exactly a placeholder
 * directory is replaced; a placeholder anywhere else is refused.
 * @param {string} text @param {{work: string, fixture: string}} places @returns {string}
 */
export function renderCandidate(text, { work, fixture }) {
  const places = /** @type {Record<string, string>} */ ({ '@WORK@/bin': join(work, 'bin'), '@FIXTURE@/bin': join(fixture, 'bin') });
  const value = JSON.parse(text);
  if (Array.isArray(value?.searchPath)) value.searchPath = value.searchPath.map((/** @type {any} */ entry) => Object.hasOwn(places, entry) ? places[entry] : entry);
  const rendered = JSON.stringify(value, (key, entry) => {
    for (const string of [key, entry]) if (typeof string === 'string' && /@(WORK|FIXTURE)@/.test(string)) throw new Error(`candidate template: unexpected placeholder ${string}`);
    return entry;
  }, 2);
  return `${rendered}\n`;
}

/**
 * The prepared program each subscriber of a rendered candidate config runs, found with the
 * candidate's own resolver. Anything but the prepared program (the route's own copy of the timeout
 * program, or the fixture's program) with its recorded digest refuses the run; a name in `missing`
 * must not resolve and is left out.
 * @param {{searchPath: string[], subscribers: {name: string, argv: string[]}[]}} config
 * @param {{resolveExecutable: typeof import('../../src/executable.js').resolveExecutable, programs: Record<string, {sha256: string, work: string}>,
 *   fixtureBin: string, workBin: string, missing?: string[]}} options
 * @returns {Promise<Record<string, {path: string, sha256: string, work: string}>>}
 */
export async function selectPrograms(config, { resolveExecutable, programs, fixtureBin, workBin, missing = [] }) {
  /** @type {Record<string, {path: string, sha256: string, work: string}>} */
  const selected = {};
  for (const { name, argv: [command] } of config.subscribers) {
    const found = resolveExecutable(command, { searchPath: config.searchPath, deadline: performance.now() + 5000 });
    if (missing.includes(name)) {
      const present = await found.catch((error) => { if (error?.code === 'EXECUTABLE_NOT_FOUND') return null; throw error; });
      if (present !== null) throw new Error(`candidate subscriber ${name} selects ${present.candidate}, but the missing-command condition needs none`);
      continue;
    }
    const { candidate, realPath } = await found;
    const program = Object.hasOwn(programs, command) ? programs[command] : null;
    const prepared = program === null ? [] : [join(fixtureBin, command), ...(command === 'relay-fixture-hang' ? [join(workBin, command)] : [])];
    const isPrepared = prepared.some((path) => { try { return realpathSync(path) === realPath; } catch { return false; } });
    if (program === null || !isPrepared || createHash('sha256').update(readFileSync(realPath)).digest('hex') !== program.sha256) {
      throw new Error(`candidate subscriber ${name} selects ${candidate}, not the prepared program`);
    }
    selected[name] = { path: realPath, sha256: program.sha256, work: program.work };
  }
  return selected;
}
