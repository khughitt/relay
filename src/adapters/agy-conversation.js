// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { relayError } from '../protocol.js';

/** @typedef {{idx: number, model: string|null, label: string|null, lastStep: number, cascade: string|null, trajectory: string|null}} Generation */
/** @param {string} message @returns {never} */
const invalid = (message) => { throw relayError('INVALID_RECORD', message); };

/** @param {Uint8Array} buf @returns {Array<{field: number, wire: 0|1|2|5, value: bigint|Uint8Array}>} */
export function decodeFields(buf) {
  if (!(buf instanceof Uint8Array)) invalid('generation data is not bytes');
  let offset = 0;
  const varint = () => {
    let value = 0n;
    for (let i = 0; i < 10; i++) {
      if (offset === buf.length) invalid('truncated protobuf varint');
      const byte = buf[offset++];
      if (i === 9 && byte > 1) invalid('protobuf varint exceeds 64 bits');
      value |= BigInt(byte & 127) << BigInt(i * 7);
      if (!(byte & 128)) return value;
    }
    return invalid('protobuf varint exceeds 10 bytes');
  };
  /** @type {Array<{field: number, wire: 0|1|2|5, value: bigint|Uint8Array}>} */
  const fields = [];
  while (offset < buf.length) {
    const tag = varint(), field = Number(tag >> 3n), wire = Number(tag & 7n);
    if (field < 1 || field > 0x1fffffff) invalid('invalid protobuf field number');
    if (wire === 0) { fields.push({ field, wire, value: varint() }); continue; }
    if (wire !== 1 && wire !== 2 && wire !== 5) invalid(`unsupported protobuf wire type ${wire}`);
    const length = wire === 2 ? Number(varint()) : wire === 1 ? 8 : 4;
    if (length > buf.length - offset) invalid('truncated protobuf field');
    fields.push({ field, wire, value: buf.subarray(offset, offset + length) });
    offset += length;
  }
  return fields;
}

/** @param {number} idx @param {Uint8Array} blob @returns {Generation} */
export function generationOf(idx, blob) {
  const metadata = decodeFields(blob).find(({ field, wire }) => field === 1 && wire === 2);
  if (!metadata || !(metadata.value instanceof Uint8Array)) invalid('generation has no field 1 message');
  /** @type {Generation} */
  const result = { idx, model: null, label: null, lastStep: 0, cascade: null, trajectory: null };
  /** @type {string|null} */
  let lastStep = null;
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  /** @param {Uint8Array} bytes */
  const text = (bytes) => {
    try { return decoder.decode(bytes); }
    catch (cause) { throw relayError('INVALID_RECORD', 'generation contains invalid UTF-8', cause); }
  };
  for (const { field, wire, value } of decodeFields(metadata.value)) {
    if (wire !== 2 || !(value instanceof Uint8Array)) continue;
    if (field === 19) result.model = text(value);
    if (field === 21) result.label = text(value);
    if (field !== 20) continue;
    let key = null, entry = null;
    for (const part of decodeFields(value)) {
      if (part.wire !== 2 || !(part.value instanceof Uint8Array)) continue;
      if (part.field === 1) key = text(part.value);
      if (part.field === 2) entry = text(part.value);
    }
    if (key === 'last_step_index') lastStep = entry;
    if (key === 'cascade_id') result.cascade = entry;
    if (key === 'trajectory_id') result.trajectory = entry;
  }
  if (lastStep === null || !/^\d+$/.test(lastStep)) invalid('generation has no decimal last_step_index');
  result.lastStep = Number(lastStep);
  return result;
}

/** @param {string} appData @param {string} conversation */
export function conversationDatabase(appData, conversation) {
  return path.join(appData, 'conversations', `${conversation}.db`);
}

/**
 * @param {string} database
 * @param {{conversation: string, step: number, importSqlite?: () => Promise<typeof import('node:sqlite')>}} options
 * @returns {Promise<{generation: Generation|null, missing: boolean}>}
 */
export async function issuingGeneration(database, { conversation, step, importSqlite = () => import('node:sqlite') }) {
  try { fs.statSync(database); }
  catch (cause) {
    const error = /** @type {import('../types.js').Failure} */ (cause);
    if (error?.code === 'ENOENT') return { generation: null, missing: true };
    throw relayError('IO_ERROR', `cannot stat ${database}`, cause);
  }
  let sqlite;
  try { sqlite = await importSqlite(); }
  catch (cause) {
    const error = /** @type {import('../types.js').Failure} */ (cause);
    if (error?.code === 'ERR_UNKNOWN_BUILTIN_MODULE') throw relayError('UNSUPPORTED_RUNTIME', `node:sqlite is unavailable in Node ${process.version}; agy model resolution needs Node 22.13 or later`, cause);
    throw cause;
  }
  let db;
  try {
    db = new sqlite.DatabaseSync(database, { readOnly: true });
    for (const row of db.prepare('select idx, data from gen_metadata order by idx desc').iterate()) {
      if (typeof row.idx !== 'number' || !(row.data instanceof Uint8Array)) invalid('invalid gen_metadata row');
      const generation = generationOf(row.idx, row.data);
      if (generation.cascade !== conversation) invalid('generation cascade_id differs from the conversation');
      if (generation.lastStep < step) return { generation, missing: false };
    }
    return { generation: null, missing: false };
  } catch (cause) {
    const error = /** @type {import('../types.js').Failure} */ (cause);
    if (error?.code === 'INVALID_RECORD') throw cause;
    throw relayError('IO_ERROR', `cannot read ${database}`, cause);
  } finally { db?.close(); }
}
