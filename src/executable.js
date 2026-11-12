// @ts-check
// Subscriber commands are PATH basenames resolved outside the event's repository. Discovery reads
// filesystem markers only (never runs git), every operation is bounded by the caller's deadline,
// and an unknown root is a failure rather than an assumption that the command is outside.
// See docs/api.md ("Subscriber commands").
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { relayError } from './protocol.js';

const MAX_ANCESTORS = 128, GITDIR_MAX_BYTES = 8192;
const ABSENT = new Set(['ENOENT', 'ENOTDIR']);

/** @param {string} code @param {string} message @param {{candidate?: string, realPath?: string|null, cause?: unknown}} [details] */
function failure(code, message, { candidate, realPath, cause } = {}) {
  return Object.assign(relayError(code, message, cause), candidate === undefined ? {} : { candidate, realPath: realPath ?? null });
}

// One filesystem step raced against the deadline. A late result is disregarded; the operations
// here only read, so abandoning one changes nothing.
/** @template T @param {() => Promise<T>} op @param {{deadline: number, clock: () => number}} timing @param {string} code @returns {Promise<T>} */
function step(op, { deadline, clock }, code) {
  const remaining = deadline - clock();
  if (remaining <= 0) return Promise.reject(failure(code, 'executable resolution deadline exceeded'));
  /** @type {NodeJS.Timeout|undefined} */
  let timer;
  const expired = new Promise((_, reject) => { timer = setTimeout(() => reject(failure(code, 'executable resolution deadline exceeded')), remaining); });
  return /** @type {Promise<T>} */ (Promise.race([op(), expired]).finally(() => clearTimeout(timer)));
}

/** Path-component containment of canonical absolute paths. @param {string} path @param {string} boundary */
export const within = (path, boundary) => boundary === sep || path === boundary || path.startsWith(`${boundary}${sep}`);

/** @param {string} dir @param {{deadline: number, clock: () => number, io: typeof fs}} options */
async function isCheckoutRoot(dir, { deadline, clock, io }) {
  const timing = { deadline, clock }, code = 'REPOSITORY_UNREADABLE';
  /** @param {string} name */
  const probe = (name) => step(() => io.lstat(join(dir, name)), timing, code).catch((error) => {
    if (ABSENT.has(error?.code)) return null;
    throw failure(code, `cannot inspect ${join(dir, name)}`, { cause: error });
  });
  const marker = await probe('.git');
  if (marker !== null) {
    if (marker.isDirectory()) return true;
    if (marker.isSymbolicLink()) {
      const target = await step(() => io.stat(join(dir, '.git')), timing, code).catch((cause) => { throw failure(code, `unusable .git link in ${dir}`, { cause }); });
      if (target.isDirectory()) return true;
      throw failure(code, `.git in ${dir} is neither a directory nor a gitdir file`);
    }
    if (!marker.isFile() || marker.size > GITDIR_MAX_BYTES) throw failure(code, `.git in ${dir} is not a readable gitdir file`);
    const text = await step(() => io.readFile(join(dir, '.git'), 'utf8'), timing, code).catch((cause) => { throw failure(code, `cannot read ${join(dir, '.git')}`, { cause }); });
    const match = /^gitdir: ([^\n]+)\n?$/.exec(text);
    if (match === null) throw failure(code, `malformed gitdir file in ${dir}`);
    const target = await step(() => io.stat(resolve(dir, match[1])), timing, code).catch((cause) => { throw failure(code, `gitdir in ${dir} names no directory`, { cause }); });
    if (!target.isDirectory()) throw failure(code, `gitdir in ${dir} names no directory`);
    return true;
  }
  const [head, objects, refs] = await Promise.all(['HEAD', 'objects', 'refs'].map(probe));
  return Boolean(head?.isFile() && objects?.isDirectory() && refs?.isDirectory());
}

/**
 * The directories a subscriber command may not be found in: each working directory (native and
 * invoking) and every checkout or bare repository enclosing either one.
 * @param {{cwd: string, invokingCwd: string, deadline: number, clock?: () => number, io?: typeof fs}} options
 * @returns {Promise<{directories: string[]}>}
 */
export async function discoverBoundaries({ cwd, invokingCwd, deadline, clock = performance.now.bind(performance), io = fs }) {
  const timing = { deadline, clock }, code = 'REPOSITORY_UNREADABLE';
  /** @type {Set<string>} */
  const directories = new Set();
  for (const start of new Set([cwd, invokingCwd])) {
    if (typeof start !== 'string' || !isAbsolute(start)) throw failure(code, 'working directory must be absolute');
    const real = await step(() => io.realpath(start), timing, code).catch((cause) => { throw cause?.code === code ? cause : failure(code, `cannot resolve working directory ${start}`, { cause }); });
    directories.add(real);
    let current = real;
    for (let depth = 0; ; depth++) {
      if (depth >= MAX_ANCESTORS) throw failure(code, `repository discovery exceeded ${MAX_ANCESTORS} ancestors from ${real}`);
      if (await isCheckoutRoot(current, { deadline, clock, io })) directories.add(current);
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return { directories: [...directories] };
}

/**
 * Resolves a command basename on PATH, refusing a candidate inside any boundary. Empty and relative
 * PATH entries are skipped. A forbidden or unusable candidate ends the search; only an absent
 * candidate advances it. childPath keeps the canonical absolute PATH directories outside the
 * boundaries, in order, for the subscriber's own lookups.
 * @param {string} command @param {{path: string|undefined, boundaries: {directories: string[]}, deadline: number, clock?: () => number, io?: typeof fs}} options
 * @returns {Promise<{candidate: string, realPath: string, childPath: string}>}
 */
export async function resolveExecutable(command, { path, boundaries, deadline, clock = performance.now.bind(performance), io = fs }) {
  if (typeof command !== 'string' || command === '' || command === '.' || command === '..' || command.includes('/') || command.includes('\0')) {
    throw failure('EXECUTABLE_FORBIDDEN', 'a subscriber command must be a basename found on PATH');
  }
  const timing = { deadline, clock };
  if (deadline - clock() <= 0) throw failure('DEADLINE_EXCEEDED', 'executable resolution deadline exceeded');
  /** @param {string} dir */
  const inside = (dir) => boundaries.directories.some((boundary) => within(dir, boundary));
  /** @param {string} candidate */
  const realOf = (candidate) => step(() => io.realpath(candidate), timing, 'DEADLINE_EXCEEDED').catch(() => null);
  /** @type {string[]} */
  const childDirs = [];
  /** @type {{candidate: string, realPath: string}|null} */
  let found = null;
  for (const entry of (path ?? '').split(':')) {
    if (entry === '' || !isAbsolute(entry)) continue;
    const dir = await step(() => io.realpath(entry), timing, 'DEADLINE_EXCEEDED').catch((error) => { if (error?.code === 'DEADLINE_EXCEEDED') throw error; return null; });
    if (dir === null) continue;
    const outside = !inside(dir);
    if (outside && !childDirs.includes(dir)) childDirs.push(dir);
    if (found !== null) continue;
    const candidate = join(dir, command);
    const link = await step(() => io.lstat(candidate), timing, 'DEADLINE_EXCEEDED').catch((error) => {
      if (ABSENT.has(error?.code)) return null;
      if (error?.code === 'DEADLINE_EXCEEDED') throw error;
      throw failure('EXECUTABLE_UNUSABLE', `cannot inspect ${candidate}`, { candidate, cause: error });
    });
    if (link === null) continue;
    if (!outside) throw failure('EXECUTABLE_FORBIDDEN', `${candidate} is inside the event's repository or working directory`, { candidate, realPath: await realOf(candidate) });
    const target = await step(() => io.stat(candidate), timing, 'DEADLINE_EXCEEDED').catch((cause) => {
      if (cause?.code === 'DEADLINE_EXCEEDED') throw cause;
      throw failure('EXECUTABLE_UNUSABLE', `${candidate} does not resolve to a file`, { candidate, cause });
    });
    if (!target.isFile()) throw failure('EXECUTABLE_UNUSABLE', `${candidate} is not a regular file`, { candidate, realPath: await realOf(candidate) });
    await step(() => io.access(candidate, constants.X_OK), timing, 'DEADLINE_EXCEEDED').catch(async (cause) => {
      if (cause?.code === 'DEADLINE_EXCEEDED') throw cause;
      throw failure('EXECUTABLE_UNUSABLE', `${candidate} is not executable`, { candidate, realPath: await realOf(candidate), cause });
    });
    const realPath = await realOf(candidate);
    if (realPath === null) throw failure('EXECUTABLE_UNUSABLE', `cannot resolve ${candidate}`, { candidate });
    found = { candidate, realPath };
  }
  if (found === null) throw failure('EXECUTABLE_NOT_FOUND', `${command} is not on PATH outside the event's repository`);
  return { ...found, childPath: childDirs.join(':') };
}
