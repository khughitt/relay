import { applyEdits, modify, parse, printParseErrorCode } from 'jsonc-parser';
import { isAbsolute } from 'node:path';
import { relayError } from '../protocol.js';

export const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const table = {
  'claude-code': [['SessionStart', 'startup|resume'], ['UserPromptSubmit'], ['PreToolUse', '*'], ['Notification:idle_prompt', 'idle_prompt'], ['Notification:permission_prompt', 'permission_prompt'], ['Stop'], ['StopFailure'], ['SessionEnd', undefined, 60000]],
  codex: [['SessionStart'], ['UserPromptSubmit'], ['PreToolUse', '*'], ['PermissionRequest'], ['Stop'], ['SessionEnd', undefined, 3000]],
};
const nativeKey = event => event.startsWith('Notification:') ? 'Notification' : event;
const esc = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const executable = "(?:'(?:[^']|'\\\\'')*'|[^\\s']+)";
// The command names node itself: a harness started from the macOS GUI inherits launchd's
// PATH (/usr/bin:/bin:/usr/sbin:/sbin), where relay.js's `#!/usr/bin/env node` finds no node.
const command = (node, bin, harness, event, outerMs, subscribersPath) => `${shellQuote(node)} ${shellQuote(bin)} hook --harness ${harness} --outer-ms ${outerMs} --subscribers ${shellQuote(subscribersPath)} ${event}`;
// An entry installed before the node path, with relay.js alone, is still relay's own.
const relay = (value, harness, event) => new RegExp(`^(?:${executable} )?${executable} hook --harness ${esc(harness)}(?: --outer-ms \\d+)?(?: --subscribers ${executable})? ${esc(event)}$`).test(value);
const familiar = (value, event) => new RegExp(`^${executable} hook(?: --agent codex)? ${esc(event)}(?: --agent codex)?$`).test(value);
// Both harnesses store a hook's outer timeout in whole seconds; relay is told the same
// budget in milliseconds. A profile that is not a positive whole second cannot be written.
export function timeoutSeconds(outerMs) {
  if (!Number.isInteger(outerMs) || outerMs < 1000 || outerMs % 1000 !== 0) throw new Error(`outer timeout must be positive whole seconds in milliseconds: ${outerMs}`);
  return outerMs / 1000;
}
const entry = (value, matcher, outerMs) => ({ ...(matcher === undefined ? {} : { matcher }), hooks: [{ type: 'command', command: value, timeout: timeoutSeconds(outerMs) }] });

export function bindingsFor(harness) {
  if (!Object.hasOwn(table, harness)) throw new Error(`unsupported hook harness: ${harness}`);
  return table[harness].map(([event, matcher, outerMs = 600000]) => ({ event, matcher, outerMs }));
}

function parseHooks(text) {
  const errors = [], value = parse(text, errors, { allowTrailingComma: true });
  if (errors.length || value === null || typeof value !== 'object' || Array.isArray(value)
    || (value.hooks !== undefined && (value.hooks === null || typeof value.hooks !== 'object' || Array.isArray(value.hooks)))) {
    throw new Error(`malformed hooks JSONC${errors.length ? `: ${errors.map(error => printParseErrorCode(error.error)).join(', ')}` : ''}`);
  }
}

export function planHooks({ text, harness, relayBin, subscribersPath, nodeBin = process.execPath, retireFamiliar = false }) {
  if (typeof subscribersPath !== 'string' || !isAbsolute(subscribersPath)) throw new Error('subscriber path must be absolute');
  if (typeof nodeBin !== 'string' || !isAbsolute(nodeBin)) throw new Error('node path must be absolute');
  parseHooks(text);
  let output = text;
  for (const binding of bindingsFor(harness)) {
    const key = nativeKey(binding.event), existing = parse(output).hooks?.[key] ?? [];
    if (!Array.isArray(existing)) throw new Error(`hooks.${key} must be an array`);
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
export function routeBindings(harness, evidence, installedVersion) {
  if (harness !== 'claude-code') throw relayError('UNSUPPORTED_BINDING', 'the ask route exists only for claude-code');
  if (!evidence) throw relayError('UNSUPPORTED_BINDING', 'the ask route needs route evidence (--evidence)');
  if (evidence.harness !== harness) throw relayError('UNSUPPORTED_BINDING', 'route evidence harness does not match install harness');
  if (typeof installedVersion !== 'string' || evidence.version !== installedVersion) {
    throw relayError('UNSUPPORTED_BINDING', `route evidence is for ${harness} ${evidence.version}, installed is ${installedVersion ?? 'unknown'}; rerun the answer route probes`);
  }
  const passed = (name) => evidence.routes?.some((r) => r.name === name && r.passed) ?? false;
  for (const name of ['answer-hook-terminal', 'answer-hook-deny-stops']) {
    if (!passed(name)) throw relayError('UNSUPPORTED_BINDING', `missing route evidence (${harness},${name})`);
  }
  const rows = [{ event: 'PreToolUse', matcher: 'AskUserQuestion', outerMs: 86400000, handback: passed('answer-release-native') }];
  if (passed('answer-receipt-observed')) rows.push({ event: 'PostToolUse', matcher: 'AskUserQuestion', outerMs: 10000 });
  return rows;
}
const askCommand = (node, bin, harness, event, handback) => `${shellQuote(node)} ${shellQuote(bin)} ask --harness ${harness}${handback ? ' --handback' : ''} ${event}`;
const askOwned = (value, harness, event) => new RegExp(`^(?:${executable} )?${executable} ask --harness ${esc(harness)}(?: --handback)? ${esc(event)}$`).test(value);
// Reconciles both route events: an owned entry whose event has no row is removed, so evidence
// that no longer supports a binding takes it out on the next plan.
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
