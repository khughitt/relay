// The declared surface. bin/relay.js keeps its strict, order-sensitive hook parser (the
// harness protocol depends on it) but takes option names, value sets, and help from here.
export const HARNESSES = ['claude-code', 'codex', 'opencode'];
export const COMMANDS = [
  { path: ['list'], summary: 'The live-agent registry' },
  { path: ['reap'], summary: 'Reconcile the registry against live processes', options: [{ names: ['--outer-ms'], value: 'int' }] },
  { path: ['hook'], summary: 'Dispatch one harness hook event to the subscribers and guards', protocol: "harness hook: stdout is the reply, exit code is the guard's",
    args: [{ name: 'event', value: 'string', required: true }],
    options: [{ names: ['--harness'], value: 'enum', values: HARNESSES, required: true }, { names: ['--outer-ms'], value: 'int' }, { names: ['--subscribers'], value: 'path' }] },
  { path: ['install'], summary: "Plan, and with --apply write, a harness's hook installation", output: 'json',
    options: [{ names: ['--harness'], value: 'enum', values: HARNESSES, required: true }, { names: ['--subscribers'], value: 'path', required: true }, { names: ['--target'], value: 'path' }, { names: ['--config-dir'], value: 'path' }, { names: ['--evidence'], value: 'path' }, { names: ['--retire'], value: 'enum', values: ['familiar'] }, { names: ['--artifact'], value: 'path' }, { names: ['--apply'], value: 'none' }] },
  { path: ['rollback'], summary: 'Undo an applied installation from its artifact', output: 'none', options: [{ names: ['--artifact'], value: 'path', required: true }] },
];

export function commandAt(name) {
  return COMMANDS.find((c) => c.path[0] === name) ?? null;
}

/** Strip --json/--pretty from anywhere; returns { argv, mode } with mode null when unset. */
export function stripGlobals(argv, usage) {
  let mode = null;
  const rest = [];
  for (const a of argv) {
    if (a === '--json' || a === '--pretty') { const m = a.slice(2); if (mode && mode !== m) throw usage('--json and --pretty are mutually exclusive'); mode = m; }
    else rest.push(a);
  }
  return { argv: rest, mode };
}

/** The diagnostics format (errors, and results where the command has any) and, separately,
 *  whether a successful run prints anything: `output = "none"` silences success only. */
export function resolveMode(flagMode, env, cmd, usage) {
  const mode = flagMode ?? env.RELAY_FORMAT ?? (cmd?.output === 'json' ? 'json' : 'pretty');
  if (!['json', 'pretty'].includes(mode)) throw usage(`RELAY_FORMAT must be json or pretty, got ${JSON.stringify(mode)}`);
  return { mode, silent: cmd?.output === 'none' };
}

export function helpText(cmd) {
  const opts = (cmd.options ?? []).map((o) => `${o.required ? '' : '['}${o.names[0]}${o.value === 'none' ? '' : ` ${o.values ? o.values.join('|') : o.value.toUpperCase()}`}${o.required ? '' : ']'}`);
  const args = (cmd.args ?? []).map((a) => a.name.toUpperCase());
  return `Usage: relay ${[...cmd.path, ...opts, ...args].join(' ')}\n\n${cmd.summary}.\n`;
}

export function rootHelp() {
  return `Usage: relay [--json|--pretty] <command>\n\n${COMMANDS.map((c) => `  ${c.path[0].padEnd(9)} ${c.summary}`).join('\n')}\n\nRun 'relay <command> --help' for details.\n`;
}
