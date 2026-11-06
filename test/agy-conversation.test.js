import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { decodeFields, generationOf, conversationDatabase, issuingGeneration } from '../src/adapters/agy-conversation.js';
import { encodeGeneration, agyStore } from './helpers/agy-store.js';

const conversation = '45d5430e-0906-4123-8123-0123456789ab';
const generation = (lastStep, extra = {}) => encodeGeneration({ model: 'gemini-4-argon', label: 'Gemini 4 Argon (High)', lastStep, cascade: conversation, ...extra });
const read = (database, step, extra = {}) => issuingGeneration(database, { conversation, step, ...extra });

test('decodeFields reads varint, bytes, fixed64 and fixed32 fields', () => {
  assert.deepEqual(decodeFields(Uint8Array.from([8, 150, 1, 18, 2, 104, 105, 25, 1, 2, 3, 4, 5, 6, 7, 8, 37, 9, 10, 11, 12])), [
    { field: 1, wire: 0, value: 150n },
    { field: 2, wire: 2, value: Uint8Array.of(104, 105) },
    { field: 3, wire: 1, value: Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8) },
    { field: 4, wire: 5, value: Uint8Array.of(9, 10, 11, 12) },
  ]);
});

test('decodeFields rejects unsupported wires, invalid tags and truncated fields', () => {
  for (const bytes of [[11], [12], [14], [15], [0], [8, 128], [8, ...Array(10).fill(128), 0], [8, ...Array(9).fill(255), 2], [18, 2, 1], [25, 1], [37, 1]]) {
    assert.throws(() => decodeFields(Uint8Array.from(bytes)), { code: 'INVALID_RECORD' }, String(bytes));
  }
});

test('generationOf reads metadata and ignores unknown fields', () => {
  const blob = generation(1, { trajectory: 'trajectory', extra: Uint8Array.of(40, 7) });
  assert.deepEqual(generationOf(2, Uint8Array.from([...blob, 26, 2, 8, 9])), {
    idx: 2, model: 'gemini-4-argon', label: 'Gemini 4 Argon (High)', lastStep: 1, cascade: conversation, trajectory: 'trajectory',
  });
  assert.equal(generationOf(0, generation(1, { model: undefined })).model, null);
});

test('generationOf requires a message and a decimal last_step_index', () => {
  for (const blob of [Uint8Array.of(24, 1), Uint8Array.of(10, 0), generation(undefined), generation('-1'), generation('1x'), generation('')]) {
    assert.throws(() => generationOf(0, blob), { code: 'INVALID_RECORD' });
  }
});

test('issuingGeneration selects by step strictly below the call step', async (t) => {
  const { appData, database } = agyStore(t, { conversation, rows: [generation(1), generation(4), generation(6), generation(8, { model: undefined })] });
  assert.equal(conversationDatabase(appData, conversation), database);
  assert.equal((await read(database, 3)).generation.idx, 0);
  assert.equal((await read(database, 5)).generation.idx, 1);
  assert.deepEqual(await read(database, 1), { generation: null, missing: false });
});

test('issuingGeneration rejects a decoded row belonging to another conversation', async (t) => {
  const { database } = agyStore(t, { conversation, rows: [generation(1), generation(4, { cascade: 'other' })] });
  await assert.rejects(read(database, 3), { code: 'INVALID_RECORD' });
});

test('issuingGeneration reports a missing file without loading sqlite or creating it', async (t) => {
  const { database } = agyStore(t, { conversation, rows: [] });
  fs.unlinkSync(database);
  assert.deepEqual(await read(database, 3, { importSqlite: () => { throw new Error('unexpected import'); } }), { generation: null, missing: true });
  assert.equal(fs.existsSync(database), false);
});

test('stops at the issuing generation and opens SQLite read-only', async (t) => {
  const rows = Array.from({ length: 300 }, (_, i) => generation(i));
  rows[299] = generation(299, { label: 'x'.repeat(200_000) });
  const { database } = agyStore(t, { conversation, rows });
  let yielded = 0, closed = false;
  const importSqlite = async () => ({ DatabaseSync: class extends DatabaseSync {
    constructor(file, options) {
      super(file, options);
      assert.throws(() => this.exec('create table forbidden (x)'), /readonly/i);
    }
    prepare(sql) {
      const statement = super.prepare(sql);
      return { *iterate() { for (const row of statement.iterate()) { yielded++; yield row; } } };
    }
    close() { super.close(); closed = true; }
  } });
  assert.equal((await read(database, 300, { importSqlite })).generation.idx, 299);
  assert.equal(yielded, 1);
  assert.equal(closed, true);
});

test('reads while a writer holds a transaction', async (t) => {
  const { database } = agyStore(t, { conversation, rows: [generation(1), generation(4)] });
  const writer = new DatabaseSync(database);
  try {
    writer.exec('BEGIN IMMEDIATE');
    const blob = generation(6);
    writer.prepare('insert into gen_metadata values (?, ?, ?)').run(2, blob, blob.length);
    assert.equal((await read(database, 7)).generation.idx, 1);
  } finally {
    writer.exec('ROLLBACK');
    writer.close();
  }
});

test('distinguishes an unavailable sqlite module from other import errors', async (t) => {
  const { database } = agyStore(t, { conversation, rows: [] });
  await assert.rejects(read(database, 3, { importSqlite: async () => { throw Object.assign(new Error('missing'), { code: 'ERR_UNKNOWN_BUILTIN_MODULE' }); } }),
    (error) => error.code === 'UNSUPPORTED_RUNTIME' && error.message.includes(process.version) && error.message.includes('22.13'));
  const denied = Object.assign(new Error('denied'), { code: 'EACCES' });
  await assert.rejects(read(database, 3, { importSqlite: async () => { throw denied; } }), (error) => error === denied);
});

test('wraps open/query errors and closes on malformed rows', async (t) => {
  const { database } = agyStore(t, { conversation, rows: [Uint8Array.of(10, 0)] });
  let closed = false;
  await assert.rejects(read(database, 3, { importSqlite: async () => ({ DatabaseSync: class extends DatabaseSync {
    close() { super.close(); closed = true; }
  } }) }), { code: 'INVALID_RECORD' });
  assert.equal(closed, true);
  const db = new DatabaseSync(database);
  db.exec('drop table gen_metadata');
  db.close();
  await assert.rejects(read(database, 3), { code: 'IO_ERROR' });
  fs.writeFileSync(database, 'not SQLite');
  await assert.rejects(read(database, 3), { code: 'IO_ERROR' });
});
