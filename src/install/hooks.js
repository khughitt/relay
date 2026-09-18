import { applyEdits, modify, parse, printParseErrorCode } from 'jsonc-parser';

export const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const table = {
  'claude-code': [['SessionStart', 'startup|resume'], ['UserPromptSubmit'], ['PreToolUse', '*'], ['Notification:idle_prompt', 'idle_prompt'], ['Notification:permission_prompt', 'permission_prompt'], ['Stop'], ['StopFailure'], ['SessionEnd', undefined, 60000]],
  codex: [['SessionStart'], ['UserPromptSubmit'], ['PreToolUse', '*'], ['PermissionRequest'], ['Stop'], ['SessionEnd', undefined, 3000]],
};
const nativeKey = event => event.startsWith('Notification:') ? 'Notification' : event;
const esc = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const executable = "(?:'[^']*'|\\S+)";
const command = (bin, harness, event, outerMs) => `${shellQuote(bin)} hook --harness ${harness} --outer-ms ${outerMs} ${event}`;
const relay = (value, harness, event) => new RegExp(`^${executable} hook --harness ${esc(harness)}(?: --outer-ms \\d+)? ${esc(event)}$`).test(value);
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

export function planHooks({ text, harness, relayBin, retireFamiliar = false }) {
  const errors = [], value = parse(text, errors, { allowTrailingComma: true });
  if (errors.length || value === null || typeof value !== 'object' || Array.isArray(value)
    || (value.hooks !== undefined && (value.hooks === null || typeof value.hooks !== 'object' || Array.isArray(value.hooks)))) {
    throw new Error(`malformed hooks JSONC${errors.length ? `: ${errors.map(error => printParseErrorCode(error.error)).join(', ')}` : ''}`);
  }
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
    next.push(entry(command(relayBin, harness, binding.event, binding.outerMs), binding.matcher, binding.outerMs));
    const edits = modify(output, ['hooks', key], next, { formattingOptions: { insertSpaces: true, tabSize: 2 } });
    output = applyEdits(output, edits);
  }
  return output;
}
