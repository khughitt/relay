// @ts-check
// A subscriber command is a basename found in the host's configured directories, and nowhere else:
// not on the hook process's PATH, and not by the event's or the invoking working directory. Every
// filesystem step is bounded by the caller's deadline. See docs/api.md ("Subscriber commands").
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { relayError } from './protocol.js';

const ABSENT = new Set(['ENOENT', 'ENOTDIR']);

/** @param {string} code @param {string} message @param {{candidate?: string, realPath?: string|null, cause?: unknown}} [details] */
function failure(code, message, { candidate, realPath, cause } = {}) {
  return Object.assign(relayError(code, message, cause), candidate === undefined ? {} : { candidate, realPath: realPath ?? null });
}

// One filesystem step raced against the deadline. A late result is disregarded; the operations
// here only read, so abandoning one changes nothing. A step that fails is the caller's to recover
// from or rename; one that runs out of time ends the search as itself.
/** @template T, R @param {() => Promise<T>} op @param {{deadline: number, clock: () => number}} timing @param {(error: any) => R|Promise<R>} recover @returns {Promise<T|R>} */
function step(op, { deadline, clock }, recover) {
  const late = () => failure('DEADLINE_EXCEEDED', 'executable resolution deadline exceeded');
  const remaining = deadline - clock();
  if (remaining <= 0) return Promise.reject(late());
  /** @type {NodeJS.Timeout|undefined} */
  let timer;
  const expired = new Promise((_, reject) => { timer = setTimeout(() => reject(late()), remaining); });
  return Promise.race([/** @type {Promise<T|R>} */ (op().catch(recover)), /** @type {Promise<never>} */ (expired)]).finally(() => clearTimeout(timer));
}

/**
 * The first listed directory that holds the command decides: only an absent candidate advances the
 * search, and one that is present but is not an executable regular file ends it. Directories and
 * candidates may be symlinks; realPath names the file a candidate leads to.
 * @param {string} command @param {{searchPath: string[], deadline: number, clock?: () => number, io?: typeof fs}} options
 * @returns {Promise<{candidate: string, realPath: string}>}
 */
export async function resolveExecutable(command, { searchPath, deadline, clock = performance.now.bind(performance), io = fs }) {
  const timing = { deadline, clock };
  for (const directory of searchPath) {
    const candidate = join(directory, command);
    const realOf = () => step(() => io.realpath(candidate), timing, () => null);
    /** @param {string} message @param {{realPath?: string|null, cause?: unknown}} [details] @returns {never} */
    const unusable = (message, details = {}) => { throw failure('EXECUTABLE_UNUSABLE', message, { candidate, ...details }); };
    const link = await step(() => io.lstat(candidate), timing, (cause) => ABSENT.has(cause?.code) ? null : unusable(`cannot inspect ${candidate}`, { cause }));
    if (link === null) continue;
    const target = await step(() => io.stat(candidate), timing, (cause) => unusable(`${candidate} does not resolve to a file`, { cause }));
    if (!target.isFile()) unusable(`${candidate} is not a regular file`, { realPath: await realOf() });
    const denied = await step(() => io.access(candidate, constants.X_OK).then(() => null), timing, (cause) => ({ cause }));
    if (denied !== null) unusable(`${candidate} is not executable`, { realPath: await realOf(), cause: denied.cause });
    return { candidate, realPath: await realOf() ?? unusable(`cannot resolve ${candidate}`) };
  }
  throw failure('EXECUTABLE_NOT_FOUND', `${command} is in no directory of the configured search path`);
}
