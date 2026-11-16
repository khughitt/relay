// @ts-check
// Built-in Claude task provenance (docs/adapters.md, "Claude task provenance"): which harness and
// model `tasks` stamps. SessionStart appends command-time exports to Claude's env file; the model
// itself lives in the session scratchpad's `tasks-model`, which PostModelSwitch replaces, so a
// switch reaches the next shell command. Subscriber children of every Claude event get the same
// two variables. Other harnesses get nothing. Every effect is advisory: a failed write is a
// metadata diagnostic, never a refusal, and never a claim that the new model was delivered.
import * as fsp from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { verified } from './model-identity.js';

export const STATE_FILE = 'tasks-model';
const HARNESS = 'claude-code';
const BARE = Object.freeze({ TASKS_AGENT: HARNESS, TASKS_MODEL: '' });
const READER_DIAGNOSTIC = 'relay: tasks-model state is unreadable or invalid; model cleared';

/** @param {string} value */
export const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
/** @param {unknown} error */
const codeOf = (error) => {
  const code = /** @type {{code?: unknown}} */ (error)?.code;
  return typeof code === 'string' && /^E[A-Z0-9]+$/.test(code) ? code : 'UNKNOWN';
};
/** @param {unknown} path @returns {path is string} */
const usablePath = (path) => typeof path === 'string' && path !== '' && !path.includes('\0') && isAbsolute(path);

/** The model a fact establishes, when it satisfies the stamp grammar. @param {import('./types.js').Fact<any>|undefined} fact */
function knownModel(fact) {
  if (fact?.status !== 'valid' || typeof fact.value !== 'string' || fact.value === '') return null;
  const { answer } = verified({ harness: HARNESS, model: fact.value, effort: null, source: {}, effortDetail: '' });
  return answer.verified ? /** @type {string} */ (answer.model) : null;
}
/** @param {string|null} model */
const valuesFor = (model) => model === null ? { ...BARE } : { TASKS_AGENT: `${HARNESS}/${model}`, TASKS_MODEL: model };

/** Exports that read the state at command time: the whole file must be one stamp-grammar line,
 * read by awk under the C locale, never evaluated. An absent file is an unknown model.
 * @param {string} statePath */
export function readerExports(statePath) {
  const q = shellQuote(statePath);
  const awk = `LC_ALL=C awk 'NR == 1 && /^[!-?A-~]+$/ { m = $0; next } { m = ""; exit } END { printf "%s", m }' ${q} 2>/dev/null`;
  return [
    `TASKS_MODEL=; if [ -e ${q} ] || [ -L ${q} ]; then TASKS_MODEL=$(${awk}); [ -n "$TASKS_MODEL" ] || printf '%s\\n' ${shellQuote(READER_DIAGNOSTIC)} >&2; fi; export TASKS_MODEL`,
    `export TASKS_AGENT="${HARNESS}\${TASKS_MODEL:+/$TASKS_MODEL}"`,
  ];
}
const BARE_EXPORTS = [`export TASKS_AGENT=${HARNESS}`, 'export TASKS_MODEL='];

/** Replace the state with `model` (atomically, private) or remove it.
 * @param {string} dir @param {string|null} model @param {typeof fsp} io @returns {Promise<string|null>} a failed operation */
async function writeState(dir, model, io) {
  const target = join(dir, STATE_FILE);
  if (model === null) {
    try { await io.unlink(target); return null; }
    catch (error) { return codeOf(error) === 'ENOENT' ? null : `state-remove ${codeOf(error)}`; }
  }
  const temp = join(dir, `.${STATE_FILE}.${process.pid}.${randomUUID()}.tmp`);
  try { await io.writeFile(temp, model, { mode: 0o600, flag: 'wx' }); }
  catch (error) { return `state-replace ${codeOf(error)}`; }
  try { await io.rename(temp, target); return null; }
  catch (error) { await io.unlink(temp).catch(() => {}); return `state-replace ${codeOf(error)}`; }
}

/**
 * @param {{event: import('./types.js').HookEvent, env: NodeJS.ProcessEnv}} input
 * @param {{io?: typeof fsp}} [options]
 * @returns {Promise<{values: null | {TASKS_AGENT: string, TASKS_MODEL: string}, diagnostics: string[]}>}
 */
export async function prepareClaudeProvenance({ event, env }, { io = fsp } = {}) {
  if (event.harness !== HARNESS) return { values: null, diagnostics: [] };
  const { nativeEvent } = event, diagnostics = /** @type {string[]} */ ([]);
  /** @param {string|null} failed */
  const record = (failed) => { if (failed !== null) diagnostics.push(`PROVENANCE_WRITE_FAILED: ${nativeEvent} ${failed}`); };
  const scratch = /** @type {import('./types.js').Fact<string>|undefined} */ (event.private.scratchpadDir);
  if (nativeEvent === 'PostModelSwitch') {
    const model = knownModel(event.facts.toModel);
    if (scratch?.status === 'valid') record(await writeState(scratch.value, model, io));
    else if (scratch?.status === 'invalid') diagnostics.push(`PROVENANCE_INVALID_PATH: ${nativeEvent} scratchpad`);
    return { values: valuesFor(model), diagnostics };
  }
  if (nativeEvent !== 'SessionStart') return { values: { ...BARE }, diagnostics };
  const model = knownModel(event.facts.model), envFile = env.CLAUDE_ENV_FILE;
  // Exports reach shells only through the event's env file: without one, nothing persistent is written.
  if (envFile === undefined || envFile === '') return { values: valuesFor(model), diagnostics };
  if (!usablePath(envFile)) { diagnostics.push(`PROVENANCE_INVALID_PATH: ${nativeEvent} env-file`); return { values: valuesFor(model), diagnostics }; }
  let exports = BARE_EXPORTS;
  if (scratch?.status === 'valid') {
    record(await writeState(scratch.value, model, io));
    exports = readerExports(join(scratch.value, STATE_FILE));
  } else if (scratch?.status === 'invalid') diagnostics.push(`PROVENANCE_INVALID_PATH: ${nativeEvent} scratchpad`);
  try { await io.appendFile(envFile, exports.map((line) => `${line}\n`).join(''), { mode: 0o600 }); }
  catch (error) { record(`env-append ${codeOf(error)}`); }
  return { values: valuesFor(model), diagnostics };
}
