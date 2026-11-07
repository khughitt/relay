import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** @param {number} value */
function varint(value) {
  const bytes = [];
  do { bytes.push((value % 128) | (value >= 128 ? 128 : 0)); value = Math.floor(value / 128); } while (value);
  return bytes;
}
/** @param {number} field @param {Uint8Array|string} value */
function bytes(field, value) {
  const data = typeof value === 'string' ? Buffer.from(value) : value;
  return Buffer.concat([Buffer.from([...varint(field * 8 + 2), ...varint(data.length)]), data]);
}
/** @param {{model?: string, label?: string, lastStep: number|string|undefined, cascade: string, trajectory?: string, rootCascade?: string, extra?: Uint8Array}} options */
export function encodeGeneration({ model, label, lastStep, cascade, trajectory, rootCascade, extra = new Uint8Array() }) {
  const fields = [];
  if (model !== undefined) fields.push(bytes(19, model));
  if (label !== undefined) fields.push(bytes(21, label));
  for (const [key, value] of [['last_step_index', lastStep], ['cascade_id', cascade], ['trajectory_id', trajectory], ['root_cascade_id', rootCascade]]) {
    if (value !== undefined) fields.push(bytes(20, Buffer.concat([bytes(1, key), bytes(2, String(value))])));
  }
  return Uint8Array.from(bytes(1, Buffer.concat([...fields, extra])));
}

/** @param {{rootConversationId?: string, parentConversationId?: string, extra?: Uint8Array}} [options] */
export function encodeTrajectoryMetadata({ rootConversationId, parentConversationId, extra = new Uint8Array() } = {}) {
  const fields = [];
  if (parentConversationId !== undefined) fields.push(bytes(5, parentConversationId));
  if (rootConversationId !== undefined) fields.push(bytes(6, rootConversationId));
  return Uint8Array.from(Buffer.concat([...fields, Buffer.from(extra)]));
}

/** @param {import('node:test').TestContext} t @param {{conversation: string, rows?: Uint8Array[], trajectoryMetadata?: Uint8Array|null, createTrajectoryTable?: boolean, createGenMetadataTable?: boolean}} options */
export function agyStore(t, {
  conversation,
  rows = [],
  trajectoryMetadata,
  createTrajectoryTable = trajectoryMetadata !== undefined,
  createGenMetadataTable = true,
}) {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-agy-'));
  t.after(() => fs.rmSync(appData, { recursive: true, force: true }));
  fs.mkdirSync(path.join(appData, 'conversations'));
  const database = path.join(appData, 'conversations', `${conversation}.db`);
  const db = new DatabaseSync(database);
  try {
    db.exec('pragma journal_mode = WAL;');
    if (createTrajectoryTable) {
      db.exec('create table trajectory_metadata_blob (id text DEFAULT "main", data blob)');
      if (trajectoryMetadata instanceof Uint8Array) {
        db.prepare('insert into trajectory_metadata_blob (id, data) values (?, ?)').run('main', trajectoryMetadata);
      }
    }
    if (createGenMetadataTable) {
      db.exec('create table gen_metadata (idx integer primary key, data blob, size integer)');
      const insert = db.prepare('insert into gen_metadata values (?, ?, ?)');
      rows.forEach((data, idx) => insert.run(idx, data, data.length));
    }
  } finally { db.close(); }
  return { appData, database };
}
