// @ts-check
// Read the command syntax emitted by the hook settings generator without evaluating a shell.
import { basename } from 'node:path';

/** @param {string} command */
export function commandWords(command) {
  const line = command.trim();
  const words = [...line.matchAll(/('[^'\r\n]+'|[A-Za-z0-9_./~:-]+)(?:[ \t]+|$)/gy)];
  if (!words.length || words.map(([matched]) => matched).join('') !== line) throw new Error('unsupported hook command syntax');
  return words.map(([, word]) => word.startsWith("'") ? word.slice(1, -1) : word);
}

/** Find the deployed relay binding for one event in a frozen settings hooks table. */
export function deployedRelayBinding(hooks, event) {
  const candidates = (hooks?.[event] ?? []).flatMap((group) => group.hooks ?? []).map((hook) => commandWords(hook.command))
    .filter((words) => basename(words[0]) === 'node' && basename(words[1] ?? '') === 'relay.js'
      && words[2] === 'hook' && words.at(-1) === event);
  if (candidates.length !== 1) throw new Error(`${event}: expected one deployed relay command, found ${candidates.length}`);
  const words = candidates[0];
  const flag = (name) => {
    const index = words.indexOf(name);
    if (index < 0 || index + 1 >= words.length) throw new Error(`${event}: relay command lacks ${name}`);
    return words[index + 1];
  };
  const outerMs = Number(flag('--outer-ms'));
  if (!Number.isSafeInteger(outerMs) || outerMs < 500) throw new Error(`${event}: invalid relay outer budget`);
  return { entry: words[1], config: flag('--subscribers'), outerMs };
}
