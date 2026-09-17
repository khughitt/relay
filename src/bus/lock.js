import * as fs from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { relayError, validateHandle } from '../protocol.js';
import { createProcessOps } from './proc.js';
import { checkPrivate, ensurePrivateDir } from './store.js';

async function readToken(path, io) {
  if (!await checkPrivate(path,false,{io})) return null;
  let text;
  try { text = await io.readFile(path,'utf8'); }
  catch (cause) { if (cause.code === 'ENOENT') return null; throw relayError('IO_ERROR','cannot read lock owner',cause); }
  try {
    const token = JSON.parse(text);
    if (!token || token.schema !== 1 || typeof token.nonce !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token.nonce)) throw new Error('invalid token');
    validateHandle(token.holder);
    return token;
  } catch (cause) { throw relayError('LOCK_REPAIR_REQUIRED','invalid lock owner token; operator repair required',cause); }
}
async function release(path, token, io) {
  try {
    const current = await readToken(path,io);
    if (!isDeepStrictEqual(current,token)) return relayError('LOCK_OWNERSHIP_LOST','lock ownership changed');
    await io.unlink(path);
    return null;
  } catch (cause) { return relayError('LOCK_CLEANUP_FAILED','cannot release lock',cause); }
}
async function acquire(path, token, io) {
  const temp = `${path}.tmp.${process.pid}.${randomUUID()}`;
  let acquired = false, failure;
  try {
    await io.writeFile(temp,JSON.stringify(token),{flag:'wx',mode:0o600});
    try { await io.link(temp,path); acquired = true; }
    catch (cause) { if (cause.code !== 'EEXIST') throw cause; }
  } catch (cause) { failure = relayError('IO_ERROR','cannot publish lock token',cause); }
  try { await io.unlink(temp); }
  catch (cause) {
    if (cause.code !== 'ENOENT') {
      const cleanup = relayError('LOCK_CLEANUP_FAILED','cannot clean private lock token',cause);
      const errors = [failure,cleanup].filter(Boolean);
      if (acquired) { const error = await release(path,token,io); if (error) errors.push(error); }
      if (errors.length > 1) throw new AggregateError(errors,'lock token cleanup failed');
      throw cleanup;
    }
  }
  if (failure) throw failure;
  return acquired;
}
export async function withLock(lockPath, fn, { clock = performance.now.bind(performance), deadline = clock() + 12000,
  processOps = createProcessOps(), sleep = ms => new Promise(resolve => setTimeout(resolve,ms)), io = fs } = {}) {
  let holder;
  try { holder = validateHandle(processOps.handleOf(process.pid,{clock,deadline})); }
  catch (cause) { throw relayError('LOCK_IDENTITY_UNKNOWN','writer identity unavailable',cause); }
  if ((holder.platform === 'linux' && !holder.bootId) || processOps.probe(holder,{clock,deadline}).status !== 'alive') {
    throw relayError('LOCK_IDENTITY_UNKNOWN','writer identity unavailable');
  }
  await ensurePrivateDir(dirname(lockPath),{io});
  let unknown = false, token;
  const expired = () => {
    if (clock() >= deadline) throw relayError(unknown ? 'LOCK_IDENTITY_UNKNOWN' : 'LOCK_TIMEOUT',unknown ? 'lock owner identity unavailable' : 'lock acquisition deadline exceeded');
  };
  const pause = async () => { expired(); await sleep(Math.min(20,deadline-clock())); };
  for (;;) {
    expired();
    token = {schema:1,nonce:randomUUID(),holder};
    if (await acquire(lockPath,token,io)) break;
    const owner = await readToken(lockPath,io);
    if (!owner) continue;
    const status = processOps.probe(owner.holder,{clock,deadline}).status;
    unknown = status === 'unknown';
    if (status !== 'dead') { await pause(); continue; }
    const guardPath = `${lockPath}.reclaim`, guard = {schema:1,nonce:randomUUID(),holder};
    if (!await acquire(guardPath,guard,io)) {
      const current = await readToken(guardPath,io);
      if (!current) continue;
      const guardStatus = processOps.probe(current.holder,{clock,deadline}).status;
      if (guardStatus === 'dead') throw relayError('LOCK_REPAIR_REQUIRED','abandoned reclaim guard; operator repair required');
      unknown = guardStatus === 'unknown'; await pause(); continue;
    }
    let error;
    try {
      const current = await readToken(lockPath,io);
      if (current) {
        const status = processOps.probe(current.holder,{clock,deadline}).status;
        unknown = status === 'unknown';
        if (status === 'dead') await io.unlink(lockPath);
      }
    } catch (cause) { error = cause.code?.startsWith('LOCK_') ? cause : relayError('IO_ERROR','cannot reclaim lock',cause); }
    const cleanup = await release(guardPath,guard,io);
    if (error && cleanup) throw new AggregateError([error,cleanup],'reclamation and cleanup failed');
    if (cleanup) throw relayError('LOCK_CLEANUP_FAILED','cannot release reclaim guard',cleanup);
    if (error) throw error;
  }
  let value, error;
  try { expired(); value = await fn(); } catch (cause) { error = cause; }
  const cleanupError = await release(lockPath,token,io);
  if (error && cleanupError) throw new AggregateError([error,cleanupError],'callback and lock cleanup failed');
  if (error) throw error;
  return {value,cleanupError};
}
