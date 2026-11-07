import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { decodeFields, generationOf, conversationDatabase, issuingGeneration, trajectoryRootOf, classifyConversation } from '../src/adapters/agy-conversation.js';
import { encodeGeneration, encodeTrajectoryMetadata, agyStore } from './helpers/agy-store.js';

const conversation = '45d5430e-0906-4123-8123-0123456789ab';
const rootOther = '11111111-2222-4333-8444-555555555555';
const parentOther = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
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
    idx: 2, model: 'gemini-4-argon', label: 'Gemini 4 Argon (High)', lastStep: 1, cascade: conversation, trajectory: 'trajectory', rootCascade: null,
  });
  assert.equal(generationOf(0, generation(1, { model: undefined })).model, null);
  assert.equal(generationOf(0, generation(1, { rootCascade: rootOther })).rootCascade, rootOther);
});

test('generationOf requires a message and a decimal last_step_index', () => {
  for (const blob of [Uint8Array.of(24, 1), Uint8Array.of(10, 0), generation(undefined), generation('-1'), generation('1x'), generation('')]) {
    assert.throws(() => generationOf(0, blob), { code: 'INVALID_RECORD' });
  }
});

test('generationOf preserves leading BOM content in recorded strings', () => {
  const record = generationOf(0, generation(1, { model: '\uFEFFgemini-4-argon', label: '\uFEFFGemini 4 Argon (High)',
    cascade: `\uFEFF${conversation}`, trajectory: '\uFEFFtrajectory' }));
  assert.deepEqual(record, { idx: 0, model: '\uFEFFgemini-4-argon', label: '\uFEFFGemini 4 Argon (High)',
    lastStep: 1, cascade: `\uFEFF${conversation}`, trajectory: '\uFEFFtrajectory', rootCascade: null });
});

test('generationOf does not normalize BOM-prefixed metadata keys or decimal values', () => {
  const key = Buffer.from('\uFEFFlast_step_index');
  const extra = Uint8Array.from([162, 1, key.length + 5, 10, key.length, ...key, 18, 1, 49]);
  assert.throws(() => generationOf(0, generation(undefined, { extra })), { code: 'INVALID_RECORD' });
  assert.throws(() => generationOf(0, generation('\uFEFF1')), { code: 'INVALID_RECORD' });
});

test('generationOf still rejects malformed UTF-8 in recorded strings', () => {
  assert.throws(() => generationOf(0, generation(1, { extra: Uint8Array.of(154, 1, 1, 255) })), { code: 'INVALID_RECORD' });
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

test('issuingGeneration rejects a BOM-prefixed cascade rather than comparing it equal', async (t) => {
  const { database } = agyStore(t, { conversation, rows: [generation(1, { cascade: `\uFEFF${conversation}` })] });
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

test('trajectoryRootOf classifies root and subagent and rejects malformed or contradictory blobs', () => {
  assert.deepEqual(trajectoryRootOf(conversation, encodeTrajectoryMetadata({ rootConversationId: conversation })), {
    kind: 'root', rootConversationId: conversation,
  });
  assert.deepEqual(trajectoryRootOf(conversation, encodeTrajectoryMetadata({ rootConversationId: conversation, parentConversationId: '' })), {
    kind: 'root', rootConversationId: conversation,
  });
  assert.deepEqual(trajectoryRootOf(conversation, encodeTrajectoryMetadata({ rootConversationId: rootOther, parentConversationId: parentOther })), {
    kind: 'subagent', rootConversationId: rootOther,
  });
  assert.deepEqual(trajectoryRootOf(conversation, encodeTrajectoryMetadata({ rootConversationId: rootOther })), {
    kind: 'subagent', rootConversationId: rootOther,
  });
  // Contradictory or invalid fields
  assert.throws(() => trajectoryRootOf('not-a-uuid', encodeTrajectoryMetadata({ rootConversationId: conversation })), { code: 'INVALID_RECORD' });
  assert.throws(() => trajectoryRootOf(conversation.toUpperCase(), encodeTrajectoryMetadata({ rootConversationId: conversation })), { code: 'INVALID_RECORD' });
  for (const blob of [
    encodeTrajectoryMetadata({}),
    encodeTrajectoryMetadata({ rootConversationId: 'not-a-uuid' }),
    encodeTrajectoryMetadata({ rootConversationId: conversation, parentConversationId: parentOther }),
    encodeTrajectoryMetadata({ rootConversationId: rootOther, parentConversationId: conversation }),
    encodeTrajectoryMetadata({ rootConversationId: rootOther, parentConversationId: 'not-a-uuid' }),
    // Field 6 as varint (tag 48 = 6 * 8 + 0)
    Uint8Array.of(48, 1),
    // Field 5 as varint (tag 40 = 5 * 8 + 0) before valid field 6
    encodeTrajectoryMetadata({ rootConversationId: conversation, extra: Uint8Array.of(40, 1) }),
    // Invalid UTF-8 in field 6 (tag 50 = 6 * 8 + 2, length 1, 0xff)
    Uint8Array.of(50, 1, 255),
    // Invalid UTF-8 in field 5 (tag 42 = 5 * 8 + 2, length 1, 0xff)
    Uint8Array.of(42, 1, 255),
  ]) {
    assert.throws(() => trajectoryRootOf(conversation, blob), { code: 'INVALID_RECORD' });
  }
});

test('classifyConversation classifies from trajectory_metadata_blob and falls back to gen_metadata', async (t) => {
  // Primary: trajectory_metadata_blob with empty or absent gen_metadata
  const { database: rootDb } = agyStore(t, {
    conversation,
    rows: [],
    trajectoryMetadata: encodeTrajectoryMetadata({ rootConversationId: conversation }),
    createGenMetadataTable: false,
  });
  assert.deepEqual(await classifyConversation(rootDb, { conversation }), {
    kind: 'root', rootConversationId: conversation,
  });

  const { database: subDb } = agyStore(t, {
    conversation,
    rows: [],
    trajectoryMetadata: encodeTrajectoryMetadata({ rootConversationId: rootOther, parentConversationId: rootOther }),
  });
  assert.deepEqual(await classifyConversation(subDb, { conversation }), {
    kind: 'subagent', rootConversationId: rootOther,
  });

  // Fallback: trajectory_metadata_blob table absent
  const { database: fallbackRootDb } = agyStore(t, {
    conversation,
    rows: [generation(1, { rootCascade: conversation }), generation(4, { rootCascade: conversation })],
    createTrajectoryTable: false,
  });
  assert.deepEqual(await classifyConversation(fallbackRootDb, { conversation }), {
    kind: 'root', rootConversationId: conversation,
  });

  // Fallback: trajectory_metadata_blob table present but has no 'main' row
  const { database: fallbackSubDb } = agyStore(t, {
    conversation,
    rows: [generation(1, { rootCascade: rootOther })],
    trajectoryMetadata: null,
    createTrajectoryTable: true,
  });
  assert.deepEqual(await classifyConversation(fallbackSubDb, { conversation }), {
    kind: 'subagent', rootConversationId: rootOther,
  });
});

test('classifyConversation returns uniform unknown diagnostic on missing, invalid or unreadable inputs', async (t) => {
  const noSqlite = () => { throw new Error('unexpected importSqlite'); };
  const assertUnknown = (res, id = `agy:${conversation}`) => {
    assert.equal(res.kind, 'unknown');
    assert.equal(res.diagnostic.code, 'AGY_CLASSIFICATION_UNAVAILABLE');
    assert.equal(res.diagnostic.agentId, id);
    assert.equal(typeof res.diagnostic.message, 'string');
    assert.ok(res.diagnostic.message.length > 0);
  };

  assertUnknown(await classifyConversation(null, { conversation, importSqlite: noSqlite }));
  assertUnknown(await classifyConversation('/tmp/does-not-matter.db', { conversation: 'NOT-A-UUID', importSqlite: noSqlite }), 'agy:NOT-A-UUID');

  const { database: missingDb } = agyStore(t, { conversation, rows: [] });
  fs.unlinkSync(missingDb);
  assertUnknown(await classifyConversation(missingDb, { conversation, importSqlite: noSqlite }));

  const { database: emptyDb } = agyStore(t, { conversation, rows: [], createTrajectoryTable: true, trajectoryMetadata: null });
  assertUnknown(await classifyConversation(emptyDb, { conversation }));

  const { database: wrongCascadeDb } = agyStore(t, { conversation, rows: [generation(1, { cascade: rootOther, rootCascade: conversation })] });
  assertUnknown(await classifyConversation(wrongCascadeDb, { conversation }));

  const { database: badRootCascadeDb } = agyStore(t, { conversation, rows: [generation(1, { rootCascade: 'not-a-uuid' })] });
  assertUnknown(await classifyConversation(badRootCascadeDb, { conversation }));

  const { database: badTrajDb } = agyStore(t, {
    conversation,
    trajectoryMetadata: encodeTrajectoryMetadata({ rootConversationId: conversation, parentConversationId: parentOther }),
  });
  assertUnknown(await classifyConversation(badTrajDb, { conversation }));

  const { database: corruptDb } = agyStore(t, { conversation, rows: [] });
  fs.writeFileSync(corruptDb, 'corrupt sqlite bytes');
  assertUnknown(await classifyConversation(corruptDb, { conversation }));

  const { database: validDb } = agyStore(t, {
    conversation,
    trajectoryMetadata: encodeTrajectoryMetadata({ rootConversationId: conversation }),
  });
  assertUnknown(await classifyConversation(validDb, {
    conversation,
    importSqlite: async () => { throw Object.assign(new Error('no sqlite'), { code: 'ERR_UNKNOWN_BUILTIN_MODULE' }); },
  }));
  assertUnknown(await classifyConversation(validDb, {
    conversation,
    importSqlite: async () => { throw Object.assign(new Error('permission denied'), { code: 'EACCES' }); },
  }));
});

test('classifyConversation reads committed trajectory_metadata_blob while a writer holds BEGIN IMMEDIATE and bounds timeout', async (t) => {
  const { database } = agyStore(t, {
    conversation,
    trajectoryMetadata: encodeTrajectoryMetadata({ rootConversationId: rootOther, parentConversationId: rootOther }),
  });
  const writer = new DatabaseSync(database);
  let observedOptions = null;
  const importSqlite = async () => ({ DatabaseSync: class extends DatabaseSync {
    constructor(file, options) {
      observedOptions = options;
      super(file, options);
    }
  } });
  try {
    writer.exec('BEGIN IMMEDIATE');
    writer.prepare('insert into gen_metadata values (?, ?, ?)').run(0, generation(1, { rootCascade: conversation }), 10);
    const res = await classifyConversation(database, {
      conversation,
      clock: () => 1000,
      deadline: 5000,
      importSqlite,
    });
    assert.deepEqual(res, { kind: 'subagent', rootConversationId: rootOther });
    assert.deepEqual(observedOptions, { readOnly: true, timeout: 250 });
  } finally {
    writer.exec('ROLLBACK');
    writer.close();
  }
});

test('classifyConversation propagates DEADLINE_EXCEEDED before stat, importSqlite and DatabaseSync', async (t) => {
  const { database } = agyStore(t, {
    conversation,
    trajectoryMetadata: encodeTrajectoryMetadata({ rootConversationId: conversation }),
  });
  // Expired before stat
  await assert.rejects(classifyConversation(database, {
    conversation,
    clock: () => 100,
    deadline: 100,
    importSqlite: () => { throw new Error('unexpected'); },
  }), { code: 'DEADLINE_EXCEEDED' });

  // Expired after stat, before importSqlite
  let calls = 0;
  await assert.rejects(classifyConversation(database, {
    conversation,
    clock: () => (++calls === 1 ? 50 : 100),
    deadline: 100,
    importSqlite: () => { throw new Error('unexpected'); },
  }), { code: 'DEADLINE_EXCEEDED' });

  // Expired after importSqlite, before DatabaseSync
  calls = 0;
  await assert.rejects(classifyConversation(database, {
    conversation,
    clock: () => (++calls <= 2 ? 50 : 100),
    deadline: 100,
    importSqlite: async () => ({ DatabaseSync: class { constructor() { throw new Error('unexpected open'); } } }),
  }), { code: 'DEADLINE_EXCEEDED' });
});
