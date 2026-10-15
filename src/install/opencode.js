// @ts-check
import { isAbsolute, join } from 'node:path';
import { applyEdits, modify, parse, printParseErrorCode } from 'jsonc-parser';
import { validateCapabilities } from './capabilities.js';

/** @param {{configDir: string, json?: string|null, jsonc?: string|null, relayPlugin: string, subscribers: import("../types.js").Subscribers}} options @returns {import("../types.js").Artifact} */
export function planOpenCode({ configDir, json, jsonc, relayPlugin, subscribers }) {
  if (!isAbsolute(configDir) || !isAbsolute(relayPlugin) || !(/** @type {unknown[]} */ ([null, undefined])).includes(json) && typeof json !== 'string'
    || !(/** @type {unknown[]} */ ([null, undefined])).includes(jsonc) && typeof jsonc !== 'string') throw new Error('OpenCode inputs must be explicit paths and text');
  if (json !== null && json !== undefined && jsonc !== null && jsonc !== undefined) throw new Error('ambiguous OpenCode .json and .jsonc targets');
  const name = jsonc !== null && jsonc !== undefined ? 'opencode.jsonc' : 'opencode.json';
  const before = name.endsWith('.jsonc') ? jsonc : json, source = before ?? '{}', errors = /** @type {import("jsonc-parser").ParseError[]} */ ([]), value = parse(source, errors, { allowTrailingComma: true });
  if (errors.length || value === null || typeof value !== 'object' || Array.isArray(value)
    || value.plugin !== undefined && !Array.isArray(value.plugin)) throw new Error(`malformed OpenCode JSONC${errors.length ? `: ${errors.map(error => printParseErrorCode(error.error)).join(', ')}` : ''}`);
  const plugins = value.plugin ?? [], count = plugins.filter((/** @type {unknown} */ plugin) => plugin === relayPlugin).length;
  if (count > 1) throw new Error('duplicate relay plugin writer');
  if (count === 1) return { schema: 1, harness: 'opencode', changes: [], evidence: null };
  validateCapabilities({ harness: 'opencode', subscribers, bindings: [] });
  const after = applyEdits(source, modify(source, ['plugin'], [...plugins, relayPlugin], { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
  return { schema: 1, harness: 'opencode', changes: [{ path: join(configDir, name), before: before ?? null, after }], evidence: null };
}
