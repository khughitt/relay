// @ts-check
import { applyEdits, modify, parse, printParseErrorCode } from 'jsonc-parser';
import { isAbsolute } from 'node:path';
import { relayError } from '../protocol.js';

/** @param {unknown} value */
export const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
/** @type {Record<string, [string, string?, number?][]>} */
const table = {
  'claude-code': [['SessionStart', 'startup|resume'], ['UserPromptSubmit'], ['PreToolUse', '*'], ['Notification:idle_prompt', 'idle_prompt'], ['Notification:permission_prompt', 'permission_prompt'], ['Stop'], ['StopFailure'], ['SessionEnd', undefined, 60000]],
  codex: [['SessionStart'], ['UserPromptSubmit'], ['PreToolUse', '*'], ['PermissionRequest'], ['Stop'], ['SessionEnd', undefined, 3000]],
};
/** @param {string} event */
const nativeKey = event => event.startsWith('Notification:') ? 'Notification' : event;
/** @param {string} value */
const esc = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const executable = "(?:'(?:[^']|'\\\\'')*'|[^\\s']+)";
// The command names node itself: a harness started from the macOS GUI inherits launchd's
// PATH (/usr/bin:/bin:/usr/sbin:/sbin), where relay.js's `#!/usr/bin/env node` finds no node.
// That node is the installer's own unless `relay install --node PATH` names another.
/** @param {string} node @param {string} bin @param {string} harness @param {string} event @param {number} outerMs @param {string} subscribersPath */
const command = (node, bin, harness, event, outerMs, subscribersPath) => `${shellQuote(node)} ${shellQuote(bin)} hook --harness ${harness} --outer-ms ${outerMs} --subscribers ${shellQuote(subscribersPath)} ${event}`;
// An entry installed before the node path, with relay.js alone, is still relay's own.
/** @param {string} value @param {string} harness @param {string} event */
const relay = (value, harness, event) => new RegExp(`^(?:${executable} )?${executable} hook --harness ${esc(harness)}(?: --outer-ms \\d+)?(?: --subscribers ${executable})? ${esc(event)}$`).test(value);
/** @param {string} value @param {string} event */
const familiar = (value, event) => new RegExp(`^${executable} hook(?: --agent codex)? ${esc(event)}(?: --agent codex)?$`).test(value);
// Directories that hold one Node version, which a version manager removes with it. Node
// reports its resolved binary, so a stable shim in front of one of these is not what gets
// written; the installer warns rather than guessing a different binary. fnm's per-shell link
// is what `which node` prints in an fnm shell; it outlives only that shell's session.
const versionRemoved = 'when that version is removed';
/** @type {[string, RegExp, string][]} */
const VERSIONED = [
  ['nvm or n', /\/versions\/node\/[^/]+\//, versionRemoved], ['fnm', /\/node-versions\/[^/]+\//, versionRemoved],
  ["fnm's per-shell link", /\/fnm_multishells\//, "when that shell's session ends or its runtime directory is cleared"],
  ['nodenv', /\/\.nodenv\/versions\/[^/]+\//, versionRemoved], ['Volta', /\/tools\/image\/node\/[^/]+\//, versionRemoved],
  ['asdf or mise', /\/installs\/node(?:js)?\/[^/]+\//, versionRemoved], ['Homebrew', /\/Cellar\/[^/]+\/[^/]+\//, versionRemoved],
];
/** @param {string} path */
const managed = path => VERSIONED.find(([, pattern]) => pattern.test(path)) ?? null;
/** @param {string} path */
export const versionManagerOf = path => managed(path)?.[0] ?? null;
/** @param {{nodeBin: string, relayBin: string}} options */
export function versionWarnings({ nodeBin, relayBin }) {
  return [
    [nodeBin, 'node', 'Rerun relay install with --node naming a node that outlives version changes.'],
    [relayBin, 'relay', 'Install relay outside the version manager, or rerun relay install whenever that version changes.'],
  ].flatMap(([path, name, remedy]) => {
    const [manager, , when] = managed(path) ?? [];
    return manager ? [`${name} path ${path} is managed by ${manager}; the installed hooks stop running, silently, ${when}. ${remedy}`] : [];
  });
}
// Both harnesses store a hook's outer timeout in whole seconds; relay is told the same
// budget in milliseconds. A profile that is not a positive whole second cannot be written.
/** @param {number} outerMs */
export function timeoutSeconds(outerMs) {
  if (!Number.isInteger(outerMs) || outerMs < 1000 || outerMs % 1000 !== 0) throw new Error(`outer timeout must be positive whole seconds in milliseconds: ${outerMs}`);
  return outerMs / 1000;
}
/** @param {string} value @param {string|undefined} matcher @param {number} outerMs */
const entry = (value, matcher, outerMs) => ({ ...(matcher === undefined ? {} : { matcher }), hooks: [{ type: 'command', command: value, timeout: timeoutSeconds(outerMs) }] });

/** @param {string} harness @returns {import("../types.js").Binding[]} */
export function bindingsFor(harness) {
  if (!Object.hasOwn(table, harness)) throw new Error(`unsupported hook harness: ${harness}`);
  return table[harness].map(([event, matcher, outerMs = 600000]) => ({ event, matcher, outerMs }));
}

/** @param {string} text */
function parseHooks(text) {
  const errors = /** @type {import("jsonc-parser").ParseError[]} */ ([]), value = parse(text, errors, { allowTrailingComma: true });
  if (errors.length || value === null || typeof value !== 'object' || Array.isArray(value)
    || (value.hooks !== undefined && (value.hooks === null || typeof value.hooks !== 'object' || Array.isArray(value.hooks)))) {
    throw new Error(`malformed hooks JSONC${errors.length ? `: ${errors.map(error => printParseErrorCode(error.error)).join(', ')}` : ''}`);
  }
}

/** @param {import("../types.js").HookPlan} options */
export function planHooks({ text, harness, relayBin, subscribersPath, nodeBin = process.execPath, retireFamiliar = false }) {
  if (typeof subscribersPath !== 'string' || !isAbsolute(subscribersPath)) throw new Error('subscriber path must be absolute');
  if (typeof nodeBin !== 'string' || !isAbsolute(nodeBin)) throw new Error('node path must be absolute');
  parseHooks(text);
  let output = text;
  for (const binding of bindingsFor(harness)) {
    const key = nativeKey(binding.event), existing = parse(output).hooks?.[key] ?? [];
    if (!Array.isArray(existing)) throw new Error(`hooks.${key} must be an array`);
    /** @param {any} item */
    const same = item => item?.matcher === binding.matcher && Array.isArray(item.hooks) && item.hooks.length === 1
      && item.hooks[0]?.type === 'command' && typeof item.hooks[0].command === 'string';
    const matched = existing.filter(same), owned = matched.filter(item => relay(item.hooks[0].command, harness, binding.event));
    if (owned.length > 1) throw new Error(`duplicate relay writer for ${binding.event}`);
    const old = matched.find(item => familiar(item.hooks[0].command, binding.event));
    if (old && !retireFamiliar) throw new Error(`familiar writer for ${binding.event} requires --retire familiar`);
    const next = existing.filter(item => item !== owned[0] && item !== old);
    next.push(entry(command(nodeBin, relayBin, harness, binding.event, binding.outerMs, subscribersPath), binding.matcher, binding.outerMs));
    const edits = modify(output, ['hooks', key], next, { formattingOptions: { insertSpaces: true, tabSize: 2 } });
    output = applyEdits(output, edits);
  }
  return output;
}

// The ask route (spec §9.1, §11): its own entries, gated on route evidence, not on the
// event/reply probes the dispatch bindings use.
export const ROUTE_EVIDENCE = Object.freeze(['answer-hook-terminal', 'answer-hook-deny-stops', 'answer-release-native', 'answer-receipt-observed', 'answer-hook-under-denial']);
export const ROUTE_EVENTS = Object.freeze(['PreToolUse', 'PostToolUse']);
// Route evidence holds only for the harness version it was probed on (spec §11): after an
// upgrade the probes run again before the route is installed.
/** @param {string} harness @param {import("../types.js").Evidence|null} evidence @param {string|undefined} installedVersion @returns {import("../types.js").Binding[]} */
export function routeBindings(harness, evidence, installedVersion) {
  if (harness !== 'claude-code') throw relayError('UNSUPPORTED_BINDING', 'the ask route exists only for claude-code');
  if (!evidence) throw relayError('UNSUPPORTED_BINDING', 'the ask route needs route evidence (--evidence)');
  if (evidence.harness !== harness) throw relayError('UNSUPPORTED_BINDING', 'route evidence harness does not match install harness');
  if (typeof installedVersion !== 'string' || evidence.version !== installedVersion) {
    throw relayError('UNSUPPORTED_BINDING', `route evidence is for ${harness} ${evidence.version}, installed is ${installedVersion ?? 'unknown'}; rerun the answer route probes`);
  }
  /** @param {string} name */
  const passed = (name) => evidence.routes?.some((r) => r.name === name && r.passed) ?? false;
  for (const name of ['answer-hook-terminal', 'answer-hook-deny-stops']) {
    if (!passed(name)) throw relayError('UNSUPPORTED_BINDING', `missing route evidence (${harness},${name})`);
  }
  /** @type {import("../types.js").Binding[]} */
  const rows = [{ event: 'PreToolUse', matcher: 'AskUserQuestion', outerMs: 86400000, handback: passed('answer-release-native') }];
  if (passed('answer-receipt-observed')) rows.push({ event: 'PostToolUse', matcher: 'AskUserQuestion', outerMs: 10000 });
  return rows;
}
/** @param {string} node @param {string} bin @param {string} harness @param {string} event @param {boolean} handback */
const askCommand = (node, bin, harness, event, handback) => `${shellQuote(node)} ${shellQuote(bin)} ask --harness ${harness}${handback ? ' --handback' : ''} ${event}`;
/** @param {string} value @param {string} harness @param {string} event */
const askOwned = (value, harness, event) => new RegExp(`^(?:${executable} )?${executable} ask --harness ${esc(harness)}(?: --handback)? ${esc(event)}$`).test(value);
// Reconciles both route events: an owned entry whose event has no row is removed, so evidence
// that no longer supports a binding takes it out on the next plan.
/** @param {{text: string, harness: string, relayBin: string, nodeBin?: string, rows: import("../types.js").Binding[]}} options */
export function planRouteHooks({ text, harness, relayBin, nodeBin = process.execPath, rows }) {
  if (typeof nodeBin !== 'string' || !isAbsolute(nodeBin) || !isAbsolute(relayBin)) throw new Error('node and relay paths must be absolute');
  parseHooks(text);
  let output = text;
  for (const event of ROUTE_EVENTS) {
    const row = rows.find((r) => r.event === event) ?? null;
    const existing = parse(output).hooks?.[event] ?? [];
    if (!Array.isArray(existing)) throw new Error(`hooks.${event} must be an array`);
    const owned = existing.filter((item) => Array.isArray(item?.hooks) && item.hooks.length === 1
      && typeof item.hooks[0]?.command === 'string' && askOwned(item.hooks[0].command, harness, event));
    if (owned.length > 1) throw new Error(`duplicate relay ask writer for ${event}`);
    if (!row && owned.length === 0) continue;
    const next = existing.filter((item) => item !== owned[0]);
    if (row) next.push(entry(askCommand(nodeBin, relayBin, harness, event, row.handback === true), row.matcher, row.outerMs));
    output = applyEdits(output, modify(output, ['hooks', event], next, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
  }
  return output;
}
